import { crc32, deflateRawSync } from "node:zlib"
import { mkdir, writeFile } from "node:fs/promises"

// A deterministic, compressed ZIP fixture with relative module dependencies.
const entries = [
	["Config.pkl", 'import "nested/Value.pkl" as Value\nvalue = Value.value\n'],
	["nested/Value.pkl", "value: Int(this > 0) = 42\n"],
	["nested/deep/Other.pkl", "value = 100\n"],
	[
		"Glob.pkl",
		'import* "nested/*.pkl" as Modules\ncount: Int(this == 1) = Modules.length\n',
	],
] as const
const local: Buffer[] = []
const central: Buffer[] = []
let offset = 0
for (const [name, text] of entries) {
	const filename = Buffer.from(name)
	const data = Buffer.from(text)
	const compressed = deflateRawSync(data)
	const checksum = crc32(data)
	const header = Buffer.alloc(30)
	header.writeUInt32LE(0x04034b50, 0)
	header.writeUInt16LE(20, 4)
	header.writeUInt16LE(8, 8)
	header.writeUInt32LE(checksum, 14)
	header.writeUInt32LE(compressed.length, 18)
	header.writeUInt32LE(data.length, 22)
	header.writeUInt16LE(filename.length, 26)
	local.push(header, filename, compressed)
	const directory = Buffer.alloc(46)
	directory.writeUInt32LE(0x02014b50, 0)
	directory.writeUInt16LE(20, 4)
	directory.writeUInt16LE(20, 6)
	directory.writeUInt16LE(8, 10)
	directory.writeUInt32LE(checksum, 16)
	directory.writeUInt32LE(compressed.length, 20)
	directory.writeUInt32LE(data.length, 24)
	directory.writeUInt16LE(filename.length, 28)
	directory.writeUInt32LE(offset, 42)
	central.push(directory, filename)
	offset += header.length + filename.length + compressed.length
}
const directory = Buffer.concat(central)
const end = Buffer.alloc(22)
end.writeUInt32LE(0x06054b50, 0)
end.writeUInt16LE(entries.length, 8)
end.writeUInt16LE(entries.length, 10)
end.writeUInt32LE(directory.length, 12)
end.writeUInt32LE(offset, 16)
const destination = new URL(
	"../packages/correctly/tests/public/fixtures/pkl/",
	import.meta.url,
)
await mkdir(destination, { recursive: true })
await writeFile(
	new URL("package.zip", destination),
	Buffer.concat([...local, directory, end]),
)
