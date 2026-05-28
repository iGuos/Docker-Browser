use bollard::Docker;
use std::sync::{Arc, RwLock};

static DOCKER_CLIENT: std::sync::OnceLock<Arc<RwLock<Option<Docker>>>> =
    std::sync::OnceLock::new();

fn docker_cell() -> &'static Arc<RwLock<Option<Docker>>> {
    DOCKER_CLIENT.get_or_init(|| Arc::new(RwLock::new(None)))
}

pub fn get_docker() -> Docker {
    {
        let guard = docker_cell().read().unwrap();
        if let Some(ref d) = *guard {
            return d.clone();
        }
    }
    let d = Docker::connect_with_local_defaults().expect("failed to connect to Docker");
    {
        let mut guard = docker_cell().write().unwrap();
        *guard = Some(d.clone());
    }
    d
}

pub fn reconnect() -> Result<Docker, bollard::errors::Error> {
    let d = Docker::connect_with_local_defaults()?;
    {
        let mut guard = docker_cell().write().unwrap();
        *guard = Some(d.clone());
    }
    Ok(d)
}
