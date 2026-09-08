use clap::Parser;
use wscore::{run, Config};

#[derive(Parser)]
struct Args {
    name: String,
}

fn main() {
    let args = Args::parse();
    let _ = run(Config { name: args.name });
}
