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
    #[schemars(phone)]
    phone: String,
}

#[derive(JsonSchema)]
struct Wrapper {
    optional: Option<u16>,
    list: Vec<i8>,
    tuple: (bool, u32),
    result: Result<u64, String>,
}

#[derive(JsonSchema, enumset::EnumSetType)]
enum Choice { One, Two }

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
        chrono::DateTime<chrono::Utc>, chrono::Weekday,
        uuid08::Uuid, uuid1::Uuid, url::Url,
        arrayvec05::ArrayVec<[u16; 4]>, arrayvec07::ArrayVec<u16, 4>,
        bigdecimal03::BigDecimal, bigdecimal04::BigDecimal, rust_decimal::Decimal,
        bytes::Bytes, either::Either<u16, String>, enumset::EnumSet<Choice>,
        indexmap1::IndexMap<String, u16>, indexmap2::IndexMap<String, u16>,
        semver::Version, smallvec::SmallVec<[u16; 4]>,
        smol_str::SmolStr, serde_json::Value, serde_json::value::RawValue,
        schemars::schema::RootSchema,
    );
    println!("{}", serde_json::to_string_pretty(&json!({
        "schemars": "0.8.22",
        "schemas": schemas,
    })).unwrap());
}
