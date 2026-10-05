#![allow(dead_code)]
use schemars::{schema_for, JsonSchema};
use serde_json::{json, Map, Value};
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
use std::num::*;

#[derive(JsonSchema)]
struct Attributes {
    #[schemars(email)]
    email: String,
    #[schemars(url)]
    url: String,
}

#[derive(JsonSchema)]
struct Wrapper {
    optional: Option<u16>,
    list: Vec<i8>,
    tuple: (bool, u32),
    result: Result<u64, String>,
}

#[derive(JsonSchema)]
enum Choice {
    One,
    Two,
}

#[derive(JsonSchema)]
struct EnumMap {
    values: std::collections::BTreeMap<Choice, u16>,
}
#[derive(JsonSchema)]
struct Flattened {
    #[serde(flatten)]
    choice: Choice,
}
#[derive(JsonSchema)]
struct FlattenedOptional {
    #[serde(flatten)]
    choice: Option<Choice>,
}
#[derive(JsonSchema)]
struct Recursive {
    value: u16,
    next: Option<Box<Recursive>>,
}
#[derive(JsonSchema)]
struct Transformed {
    #[schemars(length(min = 2), transform = clear_minimum)]
    value: String,
}
fn clear_minimum(schema: &mut schemars::Schema) {
    schema.as_object_mut().unwrap().remove("minLength");
}
fn main() {
    let mut schemas = Map::<String, Value>::new();
    macro_rules! add {
        ($($ty:ty),* $(,)?) => {$(
            schemas.insert(stringify!($ty).to_string(), serde_json::to_value(schema_for!($ty)).unwrap());
        )*};
    }
    add!(
        i8, i16, i32, i64, i128, isize, u8, u16, u32, u64, u128, usize, f32, f64,
        NonZeroI8, NonZeroI16, NonZeroI32, NonZeroI64, NonZeroI128, NonZeroIsize,
        NonZeroU8, NonZeroU16, NonZeroU32, NonZeroU64, NonZeroU128, NonZeroUsize,
        std::sync::atomic::AtomicI8, std::sync::atomic::AtomicI16,
        std::sync::atomic::AtomicI32, std::sync::atomic::AtomicI64,
        std::sync::atomic::AtomicIsize, std::sync::atomic::AtomicU8,
        std::sync::atomic::AtomicU16, std::sync::atomic::AtomicU32,
        std::sync::atomic::AtomicU64, std::sync::atomic::AtomicUsize,
        IpAddr, Ipv4Addr, Ipv6Addr, String, bool, char, (),
        std::net::SocketAddr, std::path::PathBuf, std::time::Duration,
        std::ops::Range<u16>, std::ops::Bound<i16>, Wrapper, Attributes,
        chrono::NaiveDate, chrono::NaiveTime, chrono::NaiveDateTime,
        chrono::DateTime<chrono::Utc>, chrono::Weekday, chrono::TimeDelta,
        jiff::civil::Date, jiff::civil::Time, jiff::civil::DateTime,
        jiff::Timestamp, jiff::Zoned, jiff::SignedDuration, jiff::Span,
        EnumMap, Flattened, FlattenedOptional, Recursive, Transformed,
        uuid1::Uuid, url::Url,
        arrayvec07::ArrayVec<u16, 4>,
        bigdecimal04::BigDecimal, rust_decimal::Decimal,
        bytes::Bytes, either::Either<u16, String>,
        indexmap2::IndexMap<String, u16>,
        semver::Version, smallvec::SmallVec<[u16; 4]>,
        smol_str02::SmolStr, serde_json::Value, serde_json::value::RawValue,
        schemars::Schema,
    );
    println!(
        "{}",
        serde_json::to_string_pretty(&json!({
            "schemas": schemas,
        }))
        .unwrap()
    );
}
