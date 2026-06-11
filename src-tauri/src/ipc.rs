//! 统一的前端返回契约 `IpcResult<T>`，与 Electron 版 `shared/ipc.ts` 保持一致：
//! 成功 `{ ok: true, data }`，失败 `{ ok: false, error }`。
//! 前端 `unwrapIpc()` 与全部调用点因此零改动。

use serde::Serialize;

#[derive(Serialize)]
pub struct IpcOk<T> {
    pub ok: bool,
    pub data: T,
}

#[derive(Serialize)]
pub struct IpcErr {
    pub ok: bool,
    pub error: String,
}

#[derive(Serialize)]
#[serde(untagged)]
pub enum IpcResult<T> {
    Ok(IpcOk<T>),
    Err(IpcErr),
}

impl<T> IpcResult<T> {
    pub fn ok(data: T) -> Self {
        IpcResult::Ok(IpcOk { ok: true, data })
    }

    pub fn err(message: impl Into<String>) -> Self {
        IpcResult::Err(IpcErr {
            ok: false,
            error: message.into(),
        })
    }
}

/// 把内部 `Result<T, E>` 归一化为前端契约；错误统一转字符串。
pub fn into_ipc<T, E: std::fmt::Display>(r: Result<T, E>) -> IpcResult<T> {
    match r {
        Ok(data) => IpcResult::ok(data),
        Err(e) => IpcResult::err(e.to_string()),
    }
}
