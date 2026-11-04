"""Produce a self-contained sketch using only the safe example configuration."""
from pathlib import Path
root = Path(__file__).resolve().parent.parent
source = (root / 'firmware/meter_gateway/meter_gateway.ino').read_text()
settings = (root / 'firmware/meter_gateway/config.example.h').read_text()
roots = (root / 'firmware/meter_gateway/trusted_roots.h').read_text()
settings = settings.replace('#pragma once\n', '').replace('// Copy to config.h (ignored by Git). Never commit the real file.\n', '').replace('#include "trusted_roots.h"\n', '')
roots = roots.replace('#pragma once\n', '')
notice = '''// SINGLE-FILE ESP32 GATEWAY — no config.h or other sketch files required.
// Edit the four YOUR_ placeholders in the SETTINGS section below.
// Obtain DEVICE_ID and the mg_ upload token from dashboard → Devices & setup.
// Keep the customized file private; never commit real Wi-Fi/device credentials.
// Public certificate roots are embedded; keep TLS verification enabled.
// Compile-tested, not physically hardware-tested; nonzero calibration pending.

'''
combined = notice + source.replace('#include "config.h"', '// ==================== SETTINGS — EDIT HERE ====================\n' + settings + '\n// ==================== EMBEDDED PUBLIC TLS ROOTS ====================\n' + roots + '\n// ==================== GATEWAY IMPLEMENTATION ====================')
assert '#include "config.h"' not in combined
assert '#include "trusted_roots.h"' not in combined
assert combined.count('-----BEGIN CERTIFICATE-----') == 7
output = root / 'firmware/meter_gateway_single/meter_gateway_single.ino'
output.write_text(combined)
print('Generated', output.relative_to(root))
