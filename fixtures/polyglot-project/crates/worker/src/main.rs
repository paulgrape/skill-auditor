//! Crate docs that say `use rand::Rng;` must not count as an import.

use std::collections::HashMap;
use serde::{Deserialize, Serialize};
use tokio::{sync::mpsc, time::Duration};
use tracing_subscriber::fmt as tracing_fmt;
use crate::config::Settings;
use self::helpers::*;

mod config;
mod helpers;

/* use reqwest::Client; commented out, ignored */

#[derive(Serialize, Deserialize)]
struct Job {
    name: String,
    tags: HashMap<String, String>,
}

#[tokio::main]
async fn main() {
    let text = "use hyper::Body; strings are ignored too";
    let job: Job = serde_json::from_str(text).unwrap_or(Job {
        name: String::new(),
        tags: HashMap::new(),
    });
    let (tx, _rx) = mpsc::channel::<Job>(8);
    let _ = tx.send(job).await;
    tracing_fmt().init();
    let _settings = Settings::default();
    let _ = Duration::from_secs(1);
}
