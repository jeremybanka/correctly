//! Build-only Rust ABI. Correctly's adapters and host IO are TypeScript.
use pklr::{Error, EvalCapabilities, Evaluator, FetchBudget, Result};
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};
use std::io::{Cursor, Read};
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex};

#[derive(Deserialize)]
struct Input {
    source: String,
    file: String,
    evaluate: bool,
    #[serde(default)]
    resources: BTreeMap<String, Value>,
    #[serde(default)]
    environment: BTreeMap<String, String>,
    #[serde(default)]
    properties: BTreeMap<String, String>,
}

#[derive(Default)]
struct State {
    resources: BTreeMap<String, Value>,
    requests: BTreeSet<String>,
    files: BTreeMap<PathBuf, Vec<u8>>,
    directories: BTreeSet<PathBuf>,
    environment: BTreeMap<String, String>,
}

struct Host(Arc<Mutex<State>>);
fn normalized(path: &Path) -> PathBuf {
    let mut result = PathBuf::new();
    for part in path.components() {
        match part {
            Component::CurDir => {}
            Component::ParentDir => {
                result.pop();
            }
            other => result.push(other.as_os_str()),
        }
    }
    result
}
impl Host {
    fn ask(&mut self, kind: &str, argument: String) -> Result<Value> {
        let key = serde_json::to_string(&(kind, argument)).unwrap();
        let mut state = self.0.lock().unwrap();
        if let Some(value) = state.resources.get(&key) {
            if let Some(message) = value.get("error").and_then(Value::as_str) {
                return Err(Error::Eval(message.into()));
            }
            return Ok(value.clone());
        }
        state.requests.insert(key);
        Err(Error::Eval("pending host resource".into()))
    }
    fn bytes(&mut self, path: &Path) -> Result<Vec<u8>> {
        let path = normalized(path);
        if let Some(bytes) = self.0.lock().unwrap().files.get(&path) {
            return Ok(bytes.clone());
        }
        let value = self.ask("bytes", path.display().to_string())?;
        serde_json::from_value(value).map_err(|e| Error::Eval(e.to_string()))
    }
}
impl EvalCapabilities for Host {
    fn read_to_string(&mut self, path: &Path) -> Result<String> {
        let path = normalized(path);
        if let Some(bytes) = self.0.lock().unwrap().files.get(&path) {
            return String::from_utf8(bytes.clone()).map_err(|e| Error::Eval(e.to_string()));
        }
        self.ask("text", path.display().to_string())?
            .as_str()
            .map(str::to_owned)
            .ok_or_else(|| Error::Eval("invalid text resource".into()))
    }
    fn path_exists(&mut self, path: &Path) -> Result<bool> {
        let path = normalized(path);
        {
            let state = self.0.lock().unwrap();
            if state.files.contains_key(&path) || state.directories.contains(&path) {
                return Ok(true);
            }
            if path.starts_with("/__correctly_pkl_packages__") {
                return Ok(false);
            }
        }
        Ok(self
            .ask("exists", path.display().to_string())?
            .as_bool()
            .unwrap_or(false))
    }
    fn canonicalize(&mut self, path: &Path) -> Result<PathBuf> {
        Ok(normalized(path))
    }
    fn read_bytes(&mut self, path: &Path) -> Result<Vec<u8>> {
        self.bytes(path)
    }
    fn create_dir_all(&mut self, path: &Path) -> Result<()> {
        self.0.lock().unwrap().directories.insert(normalized(path));
        Ok(())
    }
    fn write_atomic(&mut self, path: &Path, bytes: &[u8]) -> Result<()> {
        self.0
            .lock()
            .unwrap()
            .files
            .insert(normalized(path), bytes.to_vec());
        Ok(())
    }
    fn remove_file(&mut self, path: &Path) -> Result<()> {
        self.0.lock().unwrap().files.remove(&normalized(path));
        Ok(())
    }
    fn read_env(&mut self, name: &str) -> Result<Option<String>> {
        Ok(self.0.lock().unwrap().environment.get(name).cloned())
    }
    fn env_vars(&mut self) -> Result<Vec<(String, String)>> {
        Ok(self
            .0
            .lock()
            .unwrap()
            .environment
            .iter()
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect())
    }
    fn fetch_text(&mut self, url: &str) -> Result<String> {
        self.ask("fetch-text", url.into())?
            .as_str()
            .map(str::to_owned)
            .ok_or_else(|| Error::Eval("invalid remote text resource".into()))
    }
    fn fetch_bytes(&mut self, url: &str) -> Result<Vec<u8>> {
        serde_json::from_value(self.ask("fetch-bytes", url.into())?)
            .map_err(|e| Error::Eval(e.to_string()))
    }
    // Prefetch is optional. Only demand reads should cause asynchronous host
    // requests; eagerly replaying speculative requests would make unused,
    // unavailable imports fail a document that otherwise evaluates correctly.
    fn fetch_text_many(&mut self, urls: &[String], _budget: &FetchBudget) -> Vec<Result<String>> {
        urls.iter()
            .map(|_| Err(Error::Eval("host defers prefetch".into())))
            .collect()
    }
    fn fetch_bytes_many(&mut self, urls: &[String], _budget: &FetchBudget) -> Vec<Result<Vec<u8>>> {
        urls.iter()
            .map(|_| Err(Error::Eval("host defers prefetch".into())))
            .collect()
    }
    fn temp_dir(&mut self, prefix: &str) -> Result<PathBuf> {
        let path = PathBuf::from("/__correctly_pkl_packages__").join(prefix);
        self.create_dir_all(&path)?;
        Ok(path)
    }
    fn glob(&mut self, base: &Path, pattern: &str) -> Result<Vec<PathBuf>> {
        if base.starts_with("/__correctly_pkl_packages__") {
            let matcher = glob::Pattern::new(pattern).map_err(|e| Error::Eval(e.to_string()))?;
            return Ok(self
                .0
                .lock()
                .unwrap()
                .files
                .keys()
                .filter(|path| {
                    path.strip_prefix(base).is_ok_and(|relative| {
                        matcher.matches_path_with(
                            relative,
                            glob::MatchOptions {
                                require_literal_separator: true,
                                ..glob::MatchOptions::default()
                            },
                        )
                    })
                })
                .cloned()
                .collect());
        }
        let value = self.ask(
            "glob",
            serde_json::to_string(&(normalized(base).display().to_string(), pattern)).unwrap(),
        )?;
        serde_json::from_value::<Vec<String>>(value)
            .map(|paths| paths.into_iter().map(PathBuf::from).collect())
            .map_err(|e| Error::Eval(e.to_string()))
    }
    fn extract_zip(&mut self, bytes: Vec<u8>, destination: &Path) -> Result<()> {
        let mut archive =
            zip::ZipArchive::new(Cursor::new(bytes)).map_err(|e| Error::Eval(e.to_string()))?;
        if archive.len() > 4096 {
            return Err(Error::Eval("package has too many entries".into()));
        }
        let mut remaining = 16 * 1024 * 1024;
        for index in 0..archive.len() {
            let mut entry = archive
                .by_index(index)
                .map_err(|e| Error::Eval(e.to_string()))?;
            let relative = entry
                .enclosed_name()
                .ok_or_else(|| Error::Eval("invalid package path".into()))?;
            let path = destination.join(relative);
            if entry.is_dir() {
                self.create_dir_all(&path)?;
                continue;
            }
            let mut data = Vec::new();
            (&mut entry)
                .take(remaining + 1)
                .read_to_end(&mut data)
                .map_err(|e| Error::Eval(e.to_string()))?;
            if data.len() as u64 > remaining {
                return Err(Error::Eval("expanded package exceeds 16 MiB".into()));
            }
            remaining -= data.len() as u64;
            self.write_atomic(&path, &data)?;
        }
        Ok(())
    }
}

fn execute(input: Input) -> Value {
    let parsed = pklr::lexer::lex_named(&input.source, &input.file)
        .and_then(|tokens| pklr::parser::parse_named(&tokens, &input.source, &input.file));
    if let Err(error) = parsed {
        return error_json(error);
    }
    if !input.evaluate {
        return json!({"ok": true});
    }
    let state = Arc::new(Mutex::new(State {
        resources: input.resources,
        environment: input.environment,
        ..State::default()
    }));
    let mut evaluator = Evaluator::with_capabilities(Host(state.clone()));
    let path = Path::new(&input.file);
    evaluator.set_base_path(path.parent().unwrap_or(Path::new("/")));
    evaluator.set_external_properties(input.properties);
    let outcome = evaluator
        .eval_source(&input.source, path)
        .and_then(|value| value.try_to_json());
    let requests = state
        .lock()
        .unwrap()
        .requests
        .iter()
        .cloned()
        .collect::<Vec<_>>();
    if !requests.is_empty() {
        return json!({"requests": requests});
    }
    match outcome {
        Ok(value) => json!({"ok": true, "json": value.to_string()}),
        Err(error) => error_json(error),
    }
}
fn error_json(error: Error) -> Value {
    let code = match &error {
        Error::Lex { .. } | Error::Parse { .. } => "syntax",
        Error::Unsupported(_) => "pkl/unsupported",
        _ => "pkl/evaluation",
    };
    let source = match &error {
        Error::Lex { source_name, .. } | Error::Parse { source_name, .. } => Some(source_name),
        _ => None,
    };
    json!({"error": {"code": code, "message": error.to_string(), "offset": error.source_offset(), "source": source}})
}

// Each buffer is an owned boxed slice; TypeScript frees both input and output.
#[unsafe(no_mangle)]
pub extern "C" fn allocate(length: usize) -> *mut u8 {
    Box::into_raw(vec![0u8; length].into_boxed_slice()) as *mut u8
}
#[unsafe(no_mangle)]
pub unsafe extern "C" fn deallocate(pointer: *mut u8, length: usize) {
    unsafe {
        drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(
            pointer, length,
        )));
    }
}
#[unsafe(no_mangle)]
pub unsafe extern "C" fn run(pointer: *const u8, length: usize) -> u64 {
    let bytes = unsafe { std::slice::from_raw_parts(pointer, length) };
    let response = match serde_json::from_slice::<Input>(bytes) {
        Ok(input) => execute(input),
        Err(error) => json!({"error": {"code": "pkl/runtime", "message": error.to_string()}}),
    };
    let output = serde_json::to_vec(&response).unwrap().into_boxed_slice();
    let size = output.len() as u64;
    let address = Box::into_raw(output) as *mut u8 as u64;
    (size << 32) | address
}
