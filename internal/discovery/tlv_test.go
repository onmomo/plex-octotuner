package discovery

import "testing"

func TestHdhomerunVarLengthRoundTrip(t *testing.T) {
	cases := []struct {
		name   string
		length int
	}{
		{name: "single byte", length: 127},
		{name: "two byte", length: 255},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			encoded := encodeHdhomerunVarLength(tc.length)
			decoded := readHdhomerunVarLength(encoded, 0)
			if decoded == nil {
				t.Fatalf("expected to decode %d", tc.length)
			}
			if decoded.byteLength != len(encoded) {
				t.Fatalf("byteLength = %d, want %d", decoded.byteLength, len(encoded))
			}
			if decoded.value != tc.length {
				t.Fatalf("value = %d, want %d", decoded.value, tc.length)
			}
		})
	}
}

func TestReadHdhomerunVarLengthRejectsTruncation(t *testing.T) {
	if decoded := readHdhomerunVarLength([]byte{0x80}, 0); decoded != nil {
		t.Fatalf("expected nil, got %#v", decoded)
	}
}
