use dashmap::DashMap;
use std::sync::Arc;
use tokio::sync::oneshot;

/// 流式订阅管理（用于 logs/events）。
/// 每个订阅保存一个取消发送端；调用 stop 时发送信号，后台任务收到信号后退出。
pub struct StreamSubs {
    inner: Arc<DashMap<String, oneshot::Sender<()>>>,
}

impl StreamSubs {
    pub fn new() -> Self {
        StreamSubs {
            inner: Arc::new(DashMap::new()),
        }
    }

    pub fn insert(&self, id: String) -> oneshot::Receiver<()> {
        let (tx, rx) = oneshot::channel();
        self.inner.insert(id, tx);
        rx
    }

    pub fn cancel(&self, id: &str) -> bool {
        if let Some((_, tx)) = self.inner.remove(id) {
            let _ = tx.send(());
            true
        } else {
            false
        }
    }

    #[allow(dead_code)]
    pub fn cancel_all(&self) {
        self.inner.clear();
    }
}

impl Default for StreamSubs {
    fn default() -> Self {
        Self::new()
    }
}
