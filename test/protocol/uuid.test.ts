import UUID from '../../src/protocol/uuid'

describe('UUID class tests', () => {
    test('Check the default constructor', () => {
        const uuid = new UUID()
        expect(uuid.bytes).toBeInstanceOf(Buffer)
        expect(uuid.bytes.length).toEqual(16)
    }),
        test('Check the constructor', () => {
            const input = Buffer.from([
                0x00,
                0x00,
                0x00,
                0x00,
                0x00,
                0x00,
                0x40,
                0x00,
                0x80,
                0x00,
                0x00,
                0x00,
                0x00,
                0x00,
                0x00,
                0x00,
            ])
            const uuid = new UUID(input)
            expect(uuid.bytes).toBeInstanceOf(Buffer)
            expect(uuid.bytes.length).toEqual(16)
            expect(uuid.bytes).toEqual(input)
        }),
        test('Should return valid UUIDv4 string', () => {
            for (let i = 0; i < 1000; i++) {
                const uuid = new UUID()
                expect(uuid.toString()).toMatch(
                    /^[0-9A-F]{8}-[0-9A-F]{4}-[4][0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/i,
                )
            }
        }),
        test('Constructor should throw if input is invalid', () => {
            expect(() => {
                const test = new UUID(Buffer.alloc(15))
            }).toThrow()
        })
})
