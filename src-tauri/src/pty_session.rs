use dashmap::DashMap;
use portable_pty::MasterPty;
use std::sync::{Arc, Mutex};

pub struct PtySession {
    pub master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    pub writer: Arc<Mutex<Box<dyn std::io::Write + Send>>>,
}

pub struct PtySessions {
    inner: Arc<DashMap<String, PtySession>>,
}

impl PtySessions {
    pub fn new() -> Self {
        PtySessions {
            inner: Arc::new(DashMap::new()),
        }
    }

    pub fn insert(&self, id: String, session: PtySession) {
        self.inner.insert(id, session);
    }

    pub fn remove(&self, id: &str) -> Option<PtySession> {
        self.inner.remove(id).map(|(_, v)| v)
    }

    pub fn with<F, R>(&self, id: &str, f: F) -> Option<R>
    where
        F: FnOnce(&PtySession) -> R,
    {
        self.inner.get(id).map(|s| f(&*s))
    }

    #[allow(dead_code)]
    pub fn kill_all(&self) {
        self.inner.clear();
    }
}

impl Default for PtySessions {
    fn default() -> Self {
        Self::new()
    }
}
