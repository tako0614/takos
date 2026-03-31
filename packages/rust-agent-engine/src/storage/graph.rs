use std::collections::{HashMap, HashSet, VecDeque};
use std::str::FromStr;

use async_trait::async_trait;
use tokio::sync::RwLock;

use crate::domain::AbstractNode;
use crate::error::Result;
use crate::ids::AbstractNodeId;

use super::traits::{GraphRepository, GraphTraversalHit};

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct GraphEdge {
    to: AbstractNodeId,
    predicate: String,
}

#[derive(Debug, Default)]
pub struct InMemoryGraphRepository {
    adjacency: RwLock<HashMap<AbstractNodeId, Vec<GraphEdge>>>,
}

impl InMemoryGraphRepository {
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
                .then_with(|| left.to.to_string().cmp(&right.to.to_string()))
        });
        edges
    }
}

#[async_trait]
impl GraphRepository for InMemoryGraphRepository {
    async fn index_abstract(&self, node: &AbstractNode) -> Result<()> {
        self.adjacency
            .write()
            .await
            .insert(node.id, Self::edges_for_abstract(node));
        Ok(())
    }

    async fn traverse(
        &self,
        start: &AbstractNodeId,
        max_depth: usize,
        relation_types: Option<&[String]>,
    ) -> Result<Vec<GraphTraversalHit>> {
        let adjacency = self.adjacency.read().await;
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
            if let Some(neighbors) = adjacency.get(&current) {
                for neighbor in neighbors {
                    if let Some(filters) = &filters {
                        if !filters.contains(&neighbor.predicate) {
                            continue;
                        }
                    }
                    queue.push_back((neighbor.to, depth + 1, Some(neighbor.predicate.clone())));
                }
            }
        }

        Ok(output)
    }
}
