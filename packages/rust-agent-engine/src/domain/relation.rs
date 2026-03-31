use serde::{Deserialize, Serialize};

use crate::ids::RawNodeId;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Relation {
    pub subject: String,
    pub predicate: String,
    pub object: String,
    pub weight: f32,
    pub provenance_raw_node_ids: Vec<RawNodeId>,
}
