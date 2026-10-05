use std::{collections::BTreeMap, fs};
use zed_extension_api::{self as zed, settings::LspSettings};

struct Correctly;

impl zed::Extension for Correctly {
    fn new() -> Self {
        Self
    }

    fn language_server_command(
        &mut self,
        language_server_id: &zed::LanguageServerId,
        worktree: &zed::Worktree,
    ) -> zed::Result<zed::Command> {
        let binary = LspSettings::for_worktree(language_server_id.as_ref(), worktree)?.binary;
        let mut env: BTreeMap<_, _> = worktree.shell_env().into_iter().collect();
        let mut args = Vec::new();
        let mut node = None;
        if let Some(binary) = binary {
            node = binary.path;
            args = binary.arguments.unwrap_or_default();
            env.extend(binary.env.unwrap_or_default());
        }
        let node = match node {
            Some(path) => path,
            None => zed::node_binary_path()?,
        };

        // WASM can access Zed's extension work directory, not the installation
        // directory. Embed the bundles and materialize them here on each launch.
        // Versioned paths keep already-running workers safe during upgrades.
        let dist = std::env::current_dir()
            .map_err(|error| error.to_string())?
            .join("dist")
            .join(include_str!("../dist/version.txt"));
        fs::create_dir_all(&dist).map_err(|error| error.to_string())?;
        for (name, bytes) in [
            (
                "server.mjs",
                include_bytes!("../dist/server.mjs").as_slice(),
            ),
            (
                "worker.mjs",
                include_bytes!("../dist/worker.mjs").as_slice(),
            ),
        ] {
            fs::write(dist.join(name), bytes).map_err(|error| error.to_string())?;
        }
        args.push(dist.join("server.mjs").to_string_lossy().into_owned());
        args.push("--stdio".into());
        Ok(zed::Command {
            command: node,
            args,
            env: env.into_iter().collect(),
        })
    }
}

zed::register_extension!(Correctly);
