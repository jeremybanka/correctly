export const cases: Record<string, { valid: unknown[]; invalid: unknown[] }> =
	{}
for (const bits of [8, 16, 32, 64, 128]) {
	const unsignedEnd = 2 ** bits,
		signedEnd = 2 ** (bits - 1)
	cases[`uint${bits}`] = {
		valid: [0, 1, unsignedEnd - Math.max(1, unsignedEnd * 2 ** -53)],
		invalid: [-1, 0.5, unsignedEnd, unsignedEnd * 2],
	}
	cases[`int${bits}`] = {
		valid: [-signedEnd, -1, 0, signedEnd - Math.max(1, signedEnd * 2 ** -53)],
		invalid: [-signedEnd - Math.max(1, signedEnd * 2 ** -52), 0.5, signedEnd],
	}
}
cases.int = { valid: [-Number.MAX_VALUE, 0, Number.MAX_VALUE], invalid: [0.5] }
cases.uint = { valid: [0, Number.MAX_VALUE], invalid: [-1, 0.5] }
const f32Max = (2 - 2 ** -23) * 2 ** 127
cases.float = {
	valid: [-f32Max, 0, 0.1, f32Max, 1e-50],
	invalid: [2 ** 128, -(2 ** 128)],
}
cases.double = {
	valid: [-Number.MAX_VALUE, 0, 0.1, Number.MAX_VALUE],
	invalid: [],
}
cases.ip = {
	valid: ["127.0.0.1", "::1"],
	invalid: ["256.1.1.1", "example.com", "1234::abcd::1"],
}
cases.ipv4 = { valid: ["192.0.2.1"], invalid: ["::1", "256.1.1.1"] }
cases.ipv6 = { valid: ["2001:db8::1"], invalid: ["127.0.0.1", "example.com"] }
cases.date = { valid: ["2024-02-29"], invalid: ["2023-02-29", "2024-13-01"] }
cases["date-time"] = {
	valid: ["2024-02-29T12:00:00Z"],
	invalid: ["2024-02-29T12:00:00", "2023-02-29T12:00:00Z"],
}
cases["partial-date-time"] = {
	valid: [
		"2024-02-29T12:00:00",
		"12:00:00",
		"00:00:00.123456789",
		"2016-12-31T23:59:60",
		"0000-02-29T00:00:00",
	],
	invalid: [
		"2023-02-29T12:00:00",
		"2024-02-29T12:00:00Z",
		"12:00:00+01:00",
		"24:00:00",
		"12:00:60",
		"12:00:00.1234567890",
		"2024-00-01T00:00:00",
		"2024-01-00T00:00:00",
	],
}
cases.phone = {
	valid: ["+12025550123", "+123456789012345"],
	invalid: [
		"2025550123",
		"+01234",
		"+1234567890123456",
		"+1 (202) 555-0123",
		"phone",
	],
}
cases.uri = {
	valid: ["https://example.com/"],
	invalid: ["relative/path", "not a uri"],
}
cases.email = { valid: ["person@example.com"], invalid: ["not-an-email", "x@"] }
cases.uuid = {
	valid: ["123e4567-e89b-12d3-a456-426614174000"],
	invalid: ["not-a-uuid"],
}

export function formatsIn(
	value: unknown,
	result = new Set<string>(),
): Set<string> {
	if (typeof value !== "object" || value === null) return result
	if ("format" in value && typeof value.format === "string")
		result.add(value.format)
	for (const child of Object.values(value)) formatsIn(child, result)
	return result
}
