use std::cmp::Ordering;
use std::collections::{HashMap, HashSet, VecDeque};
use std::fs;
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::sync::{Arc, Mutex, MutexGuard};

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde::{de::DeserializeOwned, Deserialize, Serialize};

use crate::domain::{AbstractNode, DistillationState, LoopState, RawNode};
use crate::error::{EngineError, Result};
use crate::ids::{AbstractNodeId, LoopId, RawNodeId, SessionId};
use crate::model::embedding::{cosine_similarity, Embedding};

use super::traits::{
    GraphRepository, GraphTraversalHit, LoopStateRepository, NodeRepository, RawLifecyclePatch,
    ScoredAbstractRef, ScoredRawRef, VectorIndex,
};

const STORE_FORMAT_VERSION: u32 = 1;

#[derive(Debug, Clone)]
pub struct FileObjectStore {
    root: PathBuf,
    gate: Arc<Mutex<()>>,
}

impl FileObjectStore {
    pub fn open(root: impl AsRef<Path>) -> Result<Self> {
        let store = Self {
            root: root.as_ref().to_path_buf(),
            gate: Arc::new(Mutex::new(())),
        };
        store.ensure_layout()?;
        store.ensure_indexes()?;
        Ok(store)
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    fn lock(&self) -> Result<MutexGuard<'_, ()>> {
        self.gate.lock().map_err(|_| {
            EngineError::Storage("object store lock was poisoned by a prior panic".to_string())
        })
    }

    fn ensure_layout(&self) -> Result<()> {
        for directory in [
            self.raw_dir(),
            self.abstract_dir(),
            self.raw_embedding_dir(),
            self.abstract_embedding_dir(),
            self.graph_dir(),
            self.checkpoint_dir(),
        ] {
            fs::create_dir_all(&directory).map_err(|err| {
                EngineError::Storage(format!(
                    "failed to create object store directory {}: {err}",
                    directory.display()
                ))
            })?;
        }
        self.ensure_index_layout()
    }

    fn ensure_index_layout(&self) -> Result<()> {
        for directory in [
            self.raw_operation_dir(),
            self.abstract_operation_dir(),
            self.session_index_dir(),
            self.loop_index_dir(),
            self.timeline_index_dir(),
            self.backlog_index_dir(),
            self.vector_index_dir(),
        ] {
            fs::create_dir_all(&directory).map_err(|err| {
                EngineError::Storage(format!(
                    "failed to create object store index directory {}: {err}",
                    directory.display()
                ))
            })?;
        }
        Ok(())
    }

    fn ensure_indexes(&self) -> Result<()> {
        let _guard = self.lock()?;
        let mut metadata = self.ensure_metadata_unlocked()?;
        self.rebuild_indexes_unlocked(&mut metadata)
    }

    fn rebuild_indexes_unlocked(&self, metadata: &mut StoreMetadata) -> Result<()> {
        if self.index_root().exists() {
            fs::remove_dir_all(self.index_root()).map_err(|err| {
                EngineError::Storage(format!(
                    "failed to reset object store index root {}: {err}",
                    self.index_root().display()
                ))
            })?;
        }
        self.ensure_index_layout()?;

        let raw_nodes = self.list_raw_nodes_scan_unlocked()?;
        let abstract_nodes = self.list_abstract_nodes_scan_unlocked()?;

        let mut global_timeline = Vec::new();
        let mut session_timelines: HashMap<SessionId, Vec<RawIndexEntry>> = HashMap::new();
        let mut loop_timelines: HashMap<LoopId, Vec<RawIndexEntry>> = HashMap::new();
        let mut undistilled = Vec::new();
        let mut pushed_undistilled = Vec::new();

        for node in raw_nodes {
            let entry = RawIndexEntry::from(&node);
            global_timeline.push(entry.clone());
            if let Some(session_id) = node.session_id {
                session_timelines
                    .entry(session_id)
                    .or_default()
                    .push(entry.clone());
            }
            if let Some(loop_id) = node.loop_id {
                loop_timelines
                    .entry(loop_id)
                    .or_default()
                    .push(entry.clone());
            }
            if node.distillation_state != DistillationState::Distilled {
                undistilled.push(entry.clone());
                if node.overflow.was_pushed_out_of_session {
                    pushed_undistilled.push(entry.clone());
                }
            }
            if let Some(operation_key) = &node.operation_key {
                self.write_json(
                    &self.raw_operation_path(operation_key),
                    &StoredId { id: node.id },
                )?;
            }
        }

        sort_raw_index_entries(&mut global_timeline);
        self.write_json(&self.raw_timeline_path(), &global_timeline)?;
        sort_raw_index_entries(&mut undistilled);
        self.write_json(&self.undistilled_index_path(), &undistilled)?;
        sort_raw_index_entries(&mut pushed_undistilled);
        self.write_json(&self.pushed_undistilled_index_path(), &pushed_undistilled)?;

        for (session_id, mut entries) in session_timelines {
            sort_raw_index_entries(&mut entries);
            self.write_json(&self.session_index_path(&session_id), &entries)?;
        }
        for (loop_id, mut entries) in loop_timelines {
            sort_raw_index_entries(&mut entries);
            self.write_json(&self.loop_index_path(&loop_id), &entries)?;
        }

        for node in abstract_nodes {
            if let Some(operation_key) = &node.operation_key {
                self.write_json(
                    &self.abstract_operation_path(operation_key),
                    &StoredId { id: node.id },
                )?;
            }
        }

        let raw_embedding_ids =
            self.read_embedding_ids_scan_unlocked::<RawNodeId>(&self.raw_embedding_dir())?;
        self.write_manifest_unlocked(&self.raw_embedding_manifest_path(), &raw_embedding_ids)?;
        let abstract_embedding_ids = self
            .read_embedding_ids_scan_unlocked::<AbstractNodeId>(&self.abstract_embedding_dir())?;
        self.write_manifest_unlocked(
            &self.abstract_embedding_manifest_path(),
            &abstract_embedding_ids,
        )?;

        self.mark_indexes_rebuilt_unlocked(metadata)
    }

    fn metadata_path(&self) -> PathBuf {
        self.root.join("store.json")
    }

    fn index_root(&self) -> PathBuf {
        self.root.join("indexes")
    }

    fn raw_dir(&self) -> PathBuf {
        self.root.join("raw")
    }

    fn abstract_dir(&self) -> PathBuf {
        self.root.join("abstract")
    }

    fn raw_embedding_dir(&self) -> PathBuf {
        self.root.join("embeddings").join("raw")
    }

    fn abstract_embedding_dir(&self) -> PathBuf {
        self.root.join("embeddings").join("abstract")
    }

    fn graph_dir(&self) -> PathBuf {
        self.root.join("graph")
    }

    fn checkpoint_dir(&self) -> PathBuf {
        self.root.join("checkpoints")
    }

    fn raw_operation_dir(&self) -> PathBuf {
        self.index_root().join("raw_operation")
    }

    fn abstract_operation_dir(&self) -> PathBuf {
        self.index_root().join("abstract_operation")
    }

    fn session_index_dir(&self) -> PathBuf {
        self.index_root().join("session")
    }

    fn loop_index_dir(&self) -> PathBuf {
        self.index_root().join("loop")
    }

    fn timeline_index_dir(&self) -> PathBuf {
        self.index_root().join("timeline")
    }

    fn backlog_index_dir(&self) -> PathBuf {
        self.index_root().join("backlog")
    }

    fn vector_index_dir(&self) -> PathBuf {
        self.index_root().join("vector")
    }

    fn raw_path(&self, id: &RawNodeId) -> PathBuf {
        self.raw_dir().join(format!("{id}.json"))
    }

    fn abstract_path(&self, id: &AbstractNodeId) -> PathBuf {
        self.abstract_dir().join(format!("{id}.json"))
    }

    fn raw_embedding_path(&self, id: &RawNodeId) -> PathBuf {
        self.raw_embedding_dir().join(format!("{id}.json"))
    }

    fn abstract_embedding_path(&self, id: &AbstractNodeId) -> PathBuf {
        self.abstract_embedding_dir().join(format!("{id}.json"))
    }

    fn graph_path(&self, id: &AbstractNodeId) -> PathBuf {
        self.graph_dir().join(format!("{id}.json"))
    }

    fn checkpoint_path(&self, session_id: &SessionId, loop_id: &LoopId) -> PathBuf {
        self.checkpoint_dir()
            .join(format!("{session_id}--{loop_id}.json"))
    }

    fn ensure_metadata_unlocked(&self) -> Result<StoreMetadata> {
        if let Some(metadata) = self.try_read_json::<StoreMetadata>(&self.metadata_path())? {
            if metadata.format_version != STORE_FORMAT_VERSION {
                return Err(EngineError::Storage(format!(
                    "unsupported object store format version {} in {}",
                    metadata.format_version,
                    self.metadata_path().display()
                )));
            }
            return Ok(metadata);
        }

        let now = Utc::now();
        let metadata = StoreMetadata {
            format_version: STORE_FORMAT_VERSION,
            created_at: now,
            updated_at: now,
            last_index_rebuild_at: None,
        };
        self.write_json(&self.metadata_path(), &metadata)?;
        Ok(metadata)
    }

    fn write_metadata_unlocked(&self, metadata: &StoreMetadata) -> Result<()> {
        self.write_json(&self.metadata_path(), metadata)
    }

    fn touch_metadata_unlocked(&self) -> Result<()> {
        let mut metadata = self.ensure_metadata_unlocked()?;
        metadata.updated_at = Utc::now();
        self.write_metadata_unlocked(&metadata)
    }

    fn mark_indexes_rebuilt_unlocked(&self, metadata: &mut StoreMetadata) -> Result<()> {
        let now = Utc::now();
        metadata.updated_at = now;
        metadata.last_index_rebuild_at = Some(now);
        self.write_metadata_unlocked(metadata)
    }

    fn raw_operation_path(&self, operation_key: &str) -> PathBuf {
        self.raw_operation_dir()
            .join(format!("{}.json", encode_operation_key(operation_key)))
    }

    fn abstract_operation_path(&self, operation_key: &str) -> PathBuf {
        self.abstract_operation_dir()
            .join(format!("{}.json", encode_operation_key(operation_key)))
    }

    fn session_index_path(&self, session_id: &SessionId) -> PathBuf {
        self.session_index_dir().join(format!("{session_id}.json"))
    }

    fn loop_index_path(&self, loop_id: &LoopId) -> PathBuf {
        self.loop_index_dir().join(format!("{loop_id}.json"))
    }

    fn raw_timeline_path(&self) -> PathBuf {
        self.timeline_index_dir().join("raw.json")
    }

    fn undistilled_index_path(&self) -> PathBuf {
        self.backlog_index_dir().join("undistilled_raw.json")
    }

    fn pushed_undistilled_index_path(&self) -> PathBuf {
        self.backlog_index_dir().join("pushed_undistilled_raw.json")
    }

    fn raw_embedding_manifest_path(&self) -> PathBuf {
        self.vector_index_dir().join("raw_embeddings.json")
    }

    fn abstract_embedding_manifest_path(&self) -> PathBuf {
        self.vector_index_dir().join("abstract_embeddings.json")
    }

    fn write_json<T: Serialize>(&self, path: &Path, value: &T) -> Result<()> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|err| {
                EngineError::Storage(format!(
                    "failed to create parent directory {}: {err}",
                    parent.display()
                ))
            })?;
        }
        let payload = serde_json::to_vec_pretty(value).map_err(|err| {
            EngineError::Storage(format!(
                "failed to serialize object store payload {}: {err}",
                path.display()
            ))
        })?;
        let temporary = path.with_extension("tmp");
        fs::write(&temporary, payload).map_err(|err| {
            EngineError::Storage(format!(
                "failed to write temporary object {}: {err}",
                temporary.display()
            ))
        })?;
        fs::rename(&temporary, path).map_err(|err| {
            EngineError::Storage(format!(
                "failed to move object {} into place: {err}",
                path.display()
            ))
        })?;
        Ok(())
    }

    fn read_json<T: DeserializeOwned>(&self, path: &Path) -> Result<T> {
        let payload = fs::read(path).map_err(|err| {
            EngineError::Storage(format!("failed to read object {}: {err}", path.display()))
        })?;
        serde_json::from_slice(&payload).map_err(|err| {
            EngineError::Storage(format!(
                "failed to deserialize object {}: {err}",
                path.display()
            ))
        })
    }

    fn try_read_json<T: DeserializeOwned>(&self, path: &Path) -> Result<Option<T>> {
        if !path.exists() {
            return Ok(None);
        }
        self.read_json(path).map(Some)
    }

    fn remove_file_if_exists(&self, path: &Path) -> Result<()> {
        if !path.exists() {
            return Ok(());
        }
        fs::remove_file(path).map_err(|err| {
            EngineError::Storage(format!("failed to remove object {}: {err}", path.display()))
        })?;
        Ok(())
    }

    fn list_paths(&self, directory: &Path) -> Result<Vec<PathBuf>> {
        if !directory.exists() {
            return Ok(Vec::new());
        }
        let mut paths = Vec::new();
        let entries = fs::read_dir(directory).map_err(|err| {
            EngineError::Storage(format!(
                "failed to read object store directory {}: {err}",
                directory.display()
            ))
        })?;
        for entry in entries {
            let entry = entry.map_err(|err| {
                EngineError::Storage(format!(
                    "failed to enumerate object store directory {}: {err}",
                    directory.display()
                ))
            })?;
            let path = entry.path();
            if path.extension().and_then(|value| value.to_str()) == Some("json") {
                paths.push(path);
            }
        }
        paths.sort();
        Ok(paths)
    }

    fn list_raw_nodes_scan_unlocked(&self) -> Result<Vec<RawNode>> {
        let mut nodes = Vec::new();
        for path in self.list_paths(&self.raw_dir())? {
            nodes.push(self.read_json(&path)?);
        }
        nodes.sort_by(|left: &RawNode, right: &RawNode| {
            left.timestamp
                .cmp(&right.timestamp)
                .then_with(|| left.id.cmp(&right.id))
        });
        Ok(nodes)
    }

    fn list_abstract_nodes_scan_unlocked(&self) -> Result<Vec<AbstractNode>> {
        let mut nodes = Vec::new();
        for path in self.list_paths(&self.abstract_dir())? {
            nodes.push(self.read_json(&path)?);
        }
        nodes.sort_by(|left: &AbstractNode, right: &AbstractNode| {
            left.timestamp
                .cmp(&right.timestamp)
                .then_with(|| left.id.cmp(&right.id))
        });
        Ok(nodes)
    }

    fn read_raw_index_entries_unlocked(&self, path: &Path) -> Result<Vec<RawIndexEntry>> {
        Ok(self
            .try_read_json::<Vec<RawIndexEntry>>(path)?
            .unwrap_or_default())
    }

    fn write_manifest_unlocked<Id>(&self, path: &Path, ids: &[Id]) -> Result<()>
    where
        Id: Serialize + Clone + Ord,
    {
        let mut ids = ids.to_vec();
        ids.sort();
        ids.dedup();
        self.write_json(path, &IdManifest { ids })
    }

    fn read_manifest_unlocked<Id>(&self, path: &Path) -> Result<Vec<Id>>
    where
        Id: DeserializeOwned,
    {
        Ok(self
            .try_read_json::<IdManifest<Id>>(path)?
            .map(|manifest| manifest.ids)
            .unwrap_or_default())
    }

    fn upsert_manifest_id_unlocked<Id>(&self, path: &Path, id: Id) -> Result<()>
    where
        Id: Serialize + DeserializeOwned + Copy + Ord,
    {
        let mut ids = self.read_manifest_unlocked::<Id>(path)?;
        if !ids.contains(&id) {
            ids.push(id);
        }
        self.write_manifest_unlocked(path, &ids)
    }

    fn read_embedding_ids_scan_unlocked<Id>(&self, directory: &Path) -> Result<Vec<Id>>
    where
        Id: DeserializeOwned + Ord + Copy,
    {
        let mut ids = Vec::new();
        for path in self.list_paths(directory)? {
            let record: StoredEmbedding<Id> = self.read_json(&path)?;
            ids.push(record.id);
        }
        ids.sort();
        ids.dedup();
        Ok(ids)
    }

    fn upsert_raw_index_entry_unlocked(&self, path: &Path, entry: RawIndexEntry) -> Result<()> {
        let mut entries = self.read_raw_index_entries_unlocked(path)?;
        entries.retain(|existing| existing.id != entry.id);
        entries.push(entry);
        sort_raw_index_entries(&mut entries);
        self.write_json(path, &entries)
    }

    fn remove_raw_index_entry_unlocked(&self, path: &Path, id: RawNodeId) -> Result<()> {
        let mut entries = self.read_raw_index_entries_unlocked(path)?;
        let before = entries.len();
        entries.retain(|entry| entry.id != id);
        if before != entries.len() {
            self.write_json(path, &entries)?;
        }
        Ok(())
    }

    fn sync_raw_indexes_unlocked(&self, node: &RawNode) -> Result<()> {
        let entry = RawIndexEntry::from(node);
        self.upsert_raw_index_entry_unlocked(&self.raw_timeline_path(), entry.clone())?;
        if let Some(session_id) = node.session_id {
            self.upsert_raw_index_entry_unlocked(
                &self.session_index_path(&session_id),
                entry.clone(),
            )?;
        }
        if let Some(loop_id) = node.loop_id {
            self.upsert_raw_index_entry_unlocked(&self.loop_index_path(&loop_id), entry.clone())?;
        }

        let is_undistilled = node.distillation_state != DistillationState::Distilled;
        if is_undistilled {
            self.upsert_raw_index_entry_unlocked(&self.undistilled_index_path(), entry.clone())?;
        } else {
            self.remove_raw_index_entry_unlocked(&self.undistilled_index_path(), node.id)?;
        }

        let pushed = is_undistilled && node.overflow.was_pushed_out_of_session;
        if pushed {
            self.upsert_raw_index_entry_unlocked(&self.pushed_undistilled_index_path(), entry)?;
        } else {
            self.remove_raw_index_entry_unlocked(&self.pushed_undistilled_index_path(), node.id)?;
        }

        Ok(())
    }

    fn read_raw_by_ids_unlocked(&self, ids: &[RawNodeId]) -> Result<Vec<RawNode>> {
        let mut nodes = Vec::new();
        for id in ids {
            if let Some(node) = self.try_read_json::<RawNode>(&self.raw_path(id))? {
                nodes.push(node);
            }
        }
        Ok(nodes)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredId<Id> {
    id: Id,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoreMetadata {
    format_version: u32,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    last_index_rebuild_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct IdManifest<Id> {
    ids: Vec<Id>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredEmbedding<Id> {
    id: Id,
    embedding: Embedding,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
struct RawIndexEntry {
    id: RawNodeId,
    timestamp: DateTime<Utc>,
}

impl From<&RawNode> for RawIndexEntry {
    fn from(node: &RawNode) -> Self {
        Self {
            id: node.id,
            timestamp: node.timestamp,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
struct GraphEdge {
    to: AbstractNodeId,
    predicate: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredGraphEdges {
    node_id: AbstractNodeId,
    edges: Vec<GraphEdge>,
}

#[derive(Debug, Clone)]
pub struct ObjectNodeRepository {
    store: FileObjectStore,
}

impl ObjectNodeRepository {
    pub fn new(store: FileObjectStore) -> Self {
        Self { store }
    }
}

#[async_trait]
impl NodeRepository for ObjectNodeRepository {
    async fn insert_raw(&self, node: RawNode) -> Result<()> {
        let _guard = self.store.lock()?;
        self.store
            .write_json(&self.store.raw_path(&node.id), &node)?;
        if let Some(operation_key) = &node.operation_key {
            self.store.write_json(
                &self.store.raw_operation_path(operation_key),
                &StoredId { id: node.id },
            )?;
        }
        self.store.sync_raw_indexes_unlocked(&node)?;
        self.store.touch_metadata_unlocked()
    }

    async fn insert_abstract(&self, node: AbstractNode) -> Result<()> {
        let _guard = self.store.lock()?;
        self.store
            .write_json(&self.store.abstract_path(&node.id), &node)?;
        if let Some(operation_key) = &node.operation_key {
            self.store.write_json(
                &self.store.abstract_operation_path(operation_key),
                &StoredId { id: node.id },
            )?;
        }
        self.store.touch_metadata_unlocked()
    }

    async fn get_raw(&self, id: &RawNodeId) -> Result<Option<RawNode>> {
        let _guard = self.store.lock()?;
        self.store.try_read_json(&self.store.raw_path(id))
    }

    async fn get_abstract(&self, id: &AbstractNodeId) -> Result<Option<AbstractNode>> {
        let _guard = self.store.lock()?;
        self.store.try_read_json(&self.store.abstract_path(id))
    }

    async fn get_raw_by_operation_key(&self, operation_key: &str) -> Result<Option<RawNode>> {
        let _guard = self.store.lock()?;
        match self
            .store
            .try_read_json::<StoredId<RawNodeId>>(&self.store.raw_operation_path(operation_key))?
        {
            Some(record) => self.store.try_read_json(&self.store.raw_path(&record.id)),
            None => Ok(None),
        }
    }

    async fn get_abstract_by_operation_key(
        &self,
        operation_key: &str,
    ) -> Result<Option<AbstractNode>> {
        let _guard = self.store.lock()?;
        match self.store.try_read_json::<StoredId<AbstractNodeId>>(
            &self.store.abstract_operation_path(operation_key),
        )? {
            Some(record) => self
                .store
                .try_read_json(&self.store.abstract_path(&record.id)),
            None => Ok(None),
        }
    }

    async fn list_raw(&self, ids: &[RawNodeId]) -> Result<Vec<RawNode>> {
        let _guard = self.store.lock()?;
        self.store.read_raw_by_ids_unlocked(ids)
    }

    async fn list_abstract(&self, ids: &[AbstractNodeId]) -> Result<Vec<AbstractNode>> {
        let _guard = self.store.lock()?;
        let mut nodes = Vec::new();
        for id in ids {
            if let Some(node) = self
                .store
                .try_read_json::<AbstractNode>(&self.store.abstract_path(id))?
            {
                nodes.push(node);
            }
        }
        Ok(nodes)
    }

    async fn recent_session_raw(
        &self,
        session_id: &SessionId,
        limit: usize,
    ) -> Result<Vec<RawNode>> {
        let _guard = self.store.lock()?;
        let mut entries = self
            .store
            .read_raw_index_entries_unlocked(&self.store.session_index_path(session_id))?;
        entries.reverse();
        entries.truncate(limit);
        entries.reverse();
        let ids: Vec<_> = entries.into_iter().map(|entry| entry.id).collect();
        self.store.read_raw_by_ids_unlocked(&ids)
    }

    async fn session_raw(&self, session_id: &SessionId) -> Result<Vec<RawNode>> {
        let _guard = self.store.lock()?;
        let entries = self
            .store
            .read_raw_index_entries_unlocked(&self.store.session_index_path(session_id))?;
        let ids: Vec<_> = entries.into_iter().map(|entry| entry.id).collect();
        self.store.read_raw_by_ids_unlocked(&ids)
    }

    async fn raw_for_loop(&self, loop_id: &LoopId) -> Result<Vec<RawNode>> {
        let _guard = self.store.lock()?;
        let entries = self
            .store
            .read_raw_index_entries_unlocked(&self.store.loop_index_path(loop_id))?;
        let ids: Vec<_> = entries.into_iter().map(|entry| entry.id).collect();
        self.store.read_raw_by_ids_unlocked(&ids)
    }

    async fn timeline_raw(
        &self,
        session_id: Option<&SessionId>,
        from: Option<DateTime<Utc>>,
        to: Option<DateTime<Utc>>,
        limit: usize,
    ) -> Result<Vec<RawNode>> {
        let _guard = self.store.lock()?;
        let index_path = session_id
            .map(|value| self.store.session_index_path(value))
            .unwrap_or_else(|| self.store.raw_timeline_path());
        let mut entries = self.store.read_raw_index_entries_unlocked(&index_path)?;
        entries.retain(|entry| from.map(|value| entry.timestamp >= value).unwrap_or(true));
        entries.retain(|entry| to.map(|value| entry.timestamp <= value).unwrap_or(true));
        entries.sort_by(|left, right| {
            right
                .timestamp
                .cmp(&left.timestamp)
                .then_with(|| left.id.cmp(&right.id))
        });
        entries.truncate(limit);
        let ids: Vec<_> = entries.into_iter().map(|entry| entry.id).collect();
        self.store.read_raw_by_ids_unlocked(&ids)
    }

    async fn update_raw_lifecycle(
        &self,
        ids: &[RawNodeId],
        patch: &RawLifecyclePatch,
    ) -> Result<()> {
        let _guard = self.store.lock()?;
        let mut changed = false;
        for id in ids {
            if let Some(mut node) = self
                .store
                .try_read_json::<RawNode>(&self.store.raw_path(id))?
            {
                if let Some(distillation_state) = &patch.distillation_state {
                    node.distillation_state = distillation_state.clone();
                }
                if let Some(overflow) = &patch.overflow {
                    node.overflow = overflow.clone();
                }
                self.store.write_json(&self.store.raw_path(id), &node)?;
                self.store.sync_raw_indexes_unlocked(&node)?;
                changed = true;
            }
        }
        if changed {
            self.store.touch_metadata_unlocked()?;
        }
        Ok(())
    }

    async fn undistilled_raw(&self, limit: usize, only_pushed_out: bool) -> Result<Vec<RawNode>> {
        let _guard = self.store.lock()?;
        let index_path = if only_pushed_out {
            self.store.pushed_undistilled_index_path()
        } else {
            self.store.undistilled_index_path()
        };
        let mut entries = self.store.read_raw_index_entries_unlocked(&index_path)?;
        entries.truncate(limit);
        let ids: Vec<_> = entries.into_iter().map(|entry| entry.id).collect();
        self.store.read_raw_by_ids_unlocked(&ids)
    }
}

#[derive(Debug, Clone)]
pub struct ObjectVectorIndex {
    store: FileObjectStore,
}

impl ObjectVectorIndex {
    pub fn new(store: FileObjectStore) -> Self {
        Self { store }
    }
}

#[async_trait]
impl VectorIndex for ObjectVectorIndex {
    async fn index_raw(&self, id: RawNodeId, embedding: Embedding) -> Result<()> {
        let _guard = self.store.lock()?;
        self.store.write_json(
            &self.store.raw_embedding_path(&id),
            &StoredEmbedding { id, embedding },
        )?;
        self.store
            .upsert_manifest_id_unlocked(&self.store.raw_embedding_manifest_path(), id)?;
        self.store.touch_metadata_unlocked()
    }

    async fn index_abstract(&self, id: AbstractNodeId, embedding: Embedding) -> Result<()> {
        let _guard = self.store.lock()?;
        self.store.write_json(
            &self.store.abstract_embedding_path(&id),
            &StoredEmbedding { id, embedding },
        )?;
        self.store
            .upsert_manifest_id_unlocked(&self.store.abstract_embedding_manifest_path(), id)?;
        self.store.touch_metadata_unlocked()
    }

    async fn search_raw(&self, query: &Embedding, top_k: usize) -> Result<Vec<ScoredRawRef>> {
        let _guard = self.store.lock()?;
        let mut scored = Vec::new();
        for id in self
            .store
            .read_manifest_unlocked::<RawNodeId>(&self.store.raw_embedding_manifest_path())?
        {
            if let Some(record) = self
                .store
                .try_read_json::<StoredEmbedding<RawNodeId>>(&self.store.raw_embedding_path(&id))?
            {
                scored.push(ScoredRawRef {
                    id: record.id,
                    score: cosine_similarity(query, &record.embedding),
                });
            }
        }
        scored.sort_by(|left, right| {
            right
                .score
                .partial_cmp(&left.score)
                .unwrap_or(Ordering::Equal)
                .then_with(|| left.id.cmp(&right.id))
        });
        scored.truncate(top_k);
        Ok(scored)
    }

    async fn search_abstract(
        &self,
        query: &Embedding,
        top_k: usize,
    ) -> Result<Vec<ScoredAbstractRef>> {
        let _guard = self.store.lock()?;
        let mut scored = Vec::new();
        for id in self.store.read_manifest_unlocked::<AbstractNodeId>(
            &self.store.abstract_embedding_manifest_path(),
        )? {
            if let Some(record) = self
                .store
                .try_read_json::<StoredEmbedding<AbstractNodeId>>(
                    &self.store.abstract_embedding_path(&id),
                )?
            {
                scored.push(ScoredAbstractRef {
                    id: record.id,
                    score: cosine_similarity(query, &record.embedding),
                });
            }
        }
        scored.sort_by(|left, right| {
            right
                .score
                .partial_cmp(&left.score)
                .unwrap_or(Ordering::Equal)
                .then_with(|| left.id.cmp(&right.id))
        });
        scored.truncate(top_k);
        Ok(scored)
    }
}

#[derive(Debug, Clone)]
pub struct ObjectGraphRepository {
    store: FileObjectStore,
}

impl ObjectGraphRepository {
    pub fn new(store: FileObjectStore) -> Self {
        Self { store }
    }

    fn edges_for_abstract(node: &AbstractNode) -> Vec<GraphEdge> {
        let mut edges = HashSet::new();
        for abstract_id in &node.references.abstract_node_ids {
            edges.insert(GraphEdge {
                to: *abstract_id,
                predicate: "reference".to_string(),
            });
        }
        for relation in &node.graph.relations {
            if let Ok(abstract_id) = AbstractNodeId::from_str(&relation.object) {
                edges.insert(GraphEdge {
                    to: abstract_id,
                    predicate: relation.predicate.clone(),
                });
            }
        }
        let mut edges: Vec<_> = edges.into_iter().collect();
        edges.sort_by(|left, right| {
            left.predicate
                .cmp(&right.predicate)
                .then_with(|| left.to.cmp(&right.to))
        });
        edges
    }
}

#[async_trait]
impl GraphRepository for ObjectGraphRepository {
    async fn index_abstract(&self, node: &AbstractNode) -> Result<()> {
        let _guard = self.store.lock()?;
        self.store.write_json(
            &self.store.graph_path(&node.id),
            &StoredGraphEdges {
                node_id: node.id,
                edges: Self::edges_for_abstract(node),
            },
        )?;
        self.store.touch_metadata_unlocked()
    }

    async fn traverse(
        &self,
        start: &AbstractNodeId,
        max_depth: usize,
        relation_types: Option<&[String]>,
    ) -> Result<Vec<GraphTraversalHit>> {
        let _guard = self.store.lock()?;
        let filters = relation_types.map(|values| values.iter().cloned().collect::<HashSet<_>>());
        let mut visited = HashSet::new();
        let mut queue = VecDeque::from([(*start, 0usize, None::<String>)]);
        let mut output = Vec::new();

        while let Some((current, depth, via_predicate)) = queue.pop_front() {
            if depth > max_depth || !visited.insert(current) {
                continue;
            }
            output.push(GraphTraversalHit {
                node_id: current,
                depth,
                via_predicate: via_predicate.clone(),
            });
            if let Some(record) = self
                .store
                .try_read_json::<StoredGraphEdges>(&self.store.graph_path(&current))?
            {
                for edge in record.edges {
                    if let Some(filters) = &filters {
                        if !filters.contains(&edge.predicate) {
                            continue;
                        }
                    }
                    queue.push_back((edge.to, depth + 1, Some(edge.predicate)));
                }
            }
        }

        Ok(output)
    }
}

#[derive(Debug, Clone)]
pub struct ObjectLoopStateRepository {
    store: FileObjectStore,
}

impl ObjectLoopStateRepository {
    pub fn new(store: FileObjectStore) -> Self {
        Self { store }
    }
}

#[async_trait]
impl LoopStateRepository for ObjectLoopStateRepository {
    async fn save_checkpoint(&self, state: LoopState) -> Result<()> {
        let _guard = self.store.lock()?;
        self.store.write_json(
            &self
                .store
                .checkpoint_path(&state.session_id, &state.loop_id),
            &state,
        )?;
        self.store.touch_metadata_unlocked()
    }

    async fn load_checkpoint(
        &self,
        session_id: &SessionId,
        loop_id: &LoopId,
    ) -> Result<Option<LoopState>> {
        let _guard = self.store.lock()?;
        self.store
            .try_read_json(&self.store.checkpoint_path(session_id, loop_id))
    }

    async fn clear_checkpoint(&self, session_id: &SessionId, loop_id: &LoopId) -> Result<()> {
        let _guard = self.store.lock()?;
        self.store
            .remove_file_if_exists(&self.store.checkpoint_path(session_id, loop_id))?;
        self.store.touch_metadata_unlocked()
    }
}

fn sort_raw_index_entries(entries: &mut [RawIndexEntry]) {
    entries.sort_by(|left, right| {
        left.timestamp
            .cmp(&right.timestamp)
            .then_with(|| left.id.cmp(&right.id))
    });
}

fn encode_operation_key(source: &str) -> String {
    let mut encoded = String::with_capacity(source.len() * 2);
    for byte in source.bytes() {
        encoded.push(hex_char(byte >> 4));
        encoded.push(hex_char(byte & 0x0f));
    }
    encoded
}

fn hex_char(value: u8) -> char {
    match value {
        0..=9 => (b'0' + value) as char,
        10..=15 => (b'a' + (value - 10)) as char,
        _ => unreachable!("hex nibble must be between 0 and 15"),
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use chrono::{Duration as ChronoDuration, Utc};
    use serde_json::Value;

    use crate::domain::{OverflowPolicy, RawNode, RawNodeKind};
    use crate::model::embedding::Embedding;

    use super::{FileObjectStore, ObjectNodeRepository, ObjectVectorIndex, RawLifecyclePatch};
    use crate::storage::traits::{NodeRepository, VectorIndex};

    fn temp_root(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "takos-agent-engine-object-store-{name}-{}",
            uuid::Uuid::new_v4()
        ))
    }

    #[test]
    fn object_store_writes_metadata_file_on_open() -> crate::Result<()> {
        let root = temp_root("metadata");
        let store = FileObjectStore::open(&root)?;
        let payload = std::fs::read_to_string(store.root().join("store.json")).map_err(|err| {
            crate::EngineError::Storage(format!("failed to read object store metadata file: {err}"))
        })?;
        let metadata: Value = serde_json::from_str(&payload).map_err(|err| {
            crate::EngineError::Storage(format!(
                "failed to parse object store metadata file: {err}"
            ))
        })?;

        assert_eq!(metadata["format_version"], 1);
        assert!(metadata["created_at"].is_string());
        assert!(metadata["updated_at"].is_string());
        assert!(metadata["last_index_rebuild_at"].is_string());

        let _ = std::fs::remove_dir_all(root);
        Ok(())
    }

    #[tokio::test]
    async fn object_store_rebuilds_materialized_indexes_on_open() -> crate::Result<()> {
        let root = temp_root("rebuild");
        let session_id = crate::SessionId::new();
        let loop_id = crate::LoopId::new();

        let store = FileObjectStore::open(&root)?;
        let repository = ObjectNodeRepository::new(store.clone());
        let vector_index = ObjectVectorIndex::new(store.clone());

        let mut older = RawNode::text(
            RawNodeKind::UserUtterance,
            Some(session_id),
            Some(loop_id),
            "user",
            "older",
            0.5,
            Vec::new(),
        );
        older.timestamp = Utc::now() - ChronoDuration::minutes(1);
        repository.insert_raw(older.clone()).await?;
        vector_index
            .index_raw(older.id, Embedding(vec![1.0, 0.0]))
            .await?;

        let newer = RawNode::text(
            RawNodeKind::AssistantUtterance,
            Some(session_id),
            Some(loop_id),
            "assistant",
            "newer",
            0.6,
            Vec::new(),
        );
        repository.insert_raw(newer.clone()).await?;
        vector_index
            .index_raw(newer.id, Embedding(vec![0.9, 0.1]))
            .await?;

        std::fs::remove_dir_all(root.join("indexes")).map_err(|err| {
            crate::EngineError::Storage(format!(
                "failed to remove object store indexes for rebuild test: {err}"
            ))
        })?;

        let reopened = FileObjectStore::open(&root)?;
        let repository = ObjectNodeRepository::new(reopened.clone());
        let vector_index = ObjectVectorIndex::new(reopened);

        let session_nodes = repository.session_raw(&session_id).await?;
        assert_eq!(session_nodes.len(), 2);
        assert_eq!(session_nodes[0].id, older.id);
        assert_eq!(session_nodes[1].id, newer.id);

        let recent = repository.timeline_raw(None, None, None, 1).await?;
        assert_eq!(recent.len(), 1);
        assert_eq!(recent[0].id, newer.id);

        let scored = vector_index
            .search_raw(&Embedding(vec![1.0, 0.0]), 2)
            .await?;
        assert_eq!(scored.len(), 2);
        assert_eq!(scored[0].id, older.id);

        let _ = std::fs::remove_dir_all(root);
        Ok(())
    }

    #[tokio::test]
    async fn object_store_recovers_from_corrupted_index_payloads_on_open() -> crate::Result<()> {
        let root = temp_root("corrupt-index");
        let session_id = crate::SessionId::new();
        let loop_id = crate::LoopId::new();

        let store = FileObjectStore::open(&root)?;
        let repository = ObjectNodeRepository::new(store.clone());
        let vector_index = ObjectVectorIndex::new(store.clone());

        let node = RawNode::text(
            RawNodeKind::UserUtterance,
            Some(session_id),
            Some(loop_id),
            "user",
            "recover me",
            0.5,
            Vec::new(),
        );
        repository.insert_raw(node.clone()).await?;
        vector_index
            .index_raw(node.id, Embedding(vec![1.0, 0.0]))
            .await?;

        std::fs::write(
            root.join("indexes").join("timeline").join("raw.json"),
            b"{ broken json",
        )
        .map_err(|err| {
            crate::EngineError::Storage(format!(
                "failed to corrupt object store index for test: {err}"
            ))
        })?;

        let reopened = FileObjectStore::open(&root)?;
        let repository = ObjectNodeRepository::new(reopened.clone());
        let vector_index = ObjectVectorIndex::new(reopened);

        let recovered = repository.timeline_raw(None, None, None, 8).await?;
        assert_eq!(recovered.len(), 1);
        assert_eq!(recovered[0].id, node.id);

        let scored = vector_index
            .search_raw(&Embedding(vec![1.0, 0.0]), 1)
            .await?;
        assert_eq!(scored.len(), 1);
        assert_eq!(scored[0].id, node.id);

        let _ = std::fs::remove_dir_all(root);
        Ok(())
    }

    #[tokio::test]
    async fn object_store_backlog_indexes_follow_lifecycle_updates() -> crate::Result<()> {
        let root = temp_root("backlog");
        let session_id = crate::SessionId::new();
        let loop_id = crate::LoopId::new();
        let store = FileObjectStore::open(&root)?;
        let repository = ObjectNodeRepository::new(store);

        let node = RawNode::text(
            RawNodeKind::Note,
            Some(session_id),
            Some(loop_id),
            "system",
            "backlog candidate",
            0.5,
            Vec::new(),
        );
        repository.insert_raw(node.clone()).await?;

        assert_eq!(repository.undistilled_raw(10, false).await?.len(), 1);
        assert_eq!(repository.undistilled_raw(10, true).await?.len(), 0);

        repository
            .update_raw_lifecycle(
                &[node.id],
                &RawLifecyclePatch {
                    distillation_state: None,
                    overflow: Some(OverflowPolicy {
                        was_pushed_out_of_session: true,
                        relax_retrieval_until: None,
                    }),
                },
            )
            .await?;

        assert_eq!(repository.undistilled_raw(10, false).await?.len(), 1);
        assert_eq!(repository.undistilled_raw(10, true).await?.len(), 1);

        repository
            .update_raw_lifecycle(
                &[node.id],
                &RawLifecyclePatch {
                    distillation_state: Some(crate::domain::DistillationState::Distilled),
                    overflow: Some(OverflowPolicy {
                        was_pushed_out_of_session: false,
                        relax_retrieval_until: None,
                    }),
                },
            )
            .await?;

        assert_eq!(repository.undistilled_raw(10, false).await?.len(), 0);
        assert_eq!(repository.undistilled_raw(10, true).await?.len(), 0);

        let _ = std::fs::remove_dir_all(root);
        Ok(())
    }
}
