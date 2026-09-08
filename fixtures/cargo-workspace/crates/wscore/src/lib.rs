use anyhow::Result;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
pub struct Config {
    pub name: String,
}

pub fn run(config: Config) -> Result<String> {
    Ok(config.name)
}
