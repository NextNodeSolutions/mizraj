use std::fmt;

use serde::{Deserialize, Serialize};
use ulid::Ulid;

#[derive(Debug, Clone, Hash, PartialEq, Eq, Serialize, Deserialize)]
pub struct SessionId(String);

impl SessionId {
    pub fn new() -> Self {
        Self(Ulid::new().to_string())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl Default for SessionId {
    fn default() -> Self {
        Self::new()
    }
}

impl fmt::Display for SessionId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;

    #[test]
    fn new_returns_26_char_ulid() {
        let id = SessionId::new();
        assert_eq!(id.as_str().len(), 26);
    }

    #[test]
    fn new_parses_back_as_ulid() {
        let id = SessionId::new();
        Ulid::from_string(id.as_str()).expect("session id must be a valid ULID");
    }

    #[test]
    fn display_matches_inner_string() {
        let id = SessionId::new();
        assert_eq!(format!("{id}"), id.as_str());
    }

    #[test]
    fn distinct_calls_produce_distinct_ids() {
        let a = SessionId::new();
        let b = SessionId::new();
        assert_ne!(a, b);
    }

    #[test]
    fn usable_as_hashmap_key() {
        let id = SessionId::new();
        let mut map: HashMap<SessionId, u32> = HashMap::new();
        map.insert(id.clone(), 1);
        assert_eq!(map.get(&id), Some(&1));
    }

    #[test]
    fn serde_round_trips_through_json() {
        let id = SessionId::new();
        let json = serde_json::to_string(&id).expect("serialize");
        let back: SessionId = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(id, back);
        assert_eq!(json, format!("\"{}\"", id.as_str()));
    }
}
