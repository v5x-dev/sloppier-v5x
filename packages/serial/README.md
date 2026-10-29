# v5x serial

TypeScript browser port of [vexide/vex-v5-serial](https://github.com/vexide/vex-v5-serial), based on commit `b3a712a16c9c6819b69faacfee2284826a138070`. The upstream MIT license is included in [LICENSE](./LICENSE).

`@v5x/serial` exports TypeScript source, like the other workspace packages. There are no runtime dependencies or Node APIs. Importing it is safe outside a browser; device discovery requires a browser.

## USB

Call `requestSerial` from a click handler in a secure context. Choose the brain's **system** port in the browser picker.

```ts
import { requestSerial, systemVersion, uploadProgram } from "@v5x/serial"

const connection = await requestSerial()
console.log(await connection.request(systemVersion()))
await uploadProgram(
  connection,
  { type: "monolith", data: binary },
  {
    slot: 1,
    name: "My robot",
    compress: true,
    onProgress: (file, percent) => console.log(file, percent),
  }
)
await connection.close()
```

`getSerialPorts()` returns previously authorized VEX ports. `openSerial(port, { userPort })` opens an existing system port with an optional separate user port. Web Serial does not expose interface numbers or USB serial numbers, so the library cannot automatically identify the system interface or group ports by brain. Controller connections are detected by USB product ID. `type: "controller"` can override detection.

## Bluetooth

Call `requestBluetooth` from a click handler. The picker filters by the V5 service UUID. VEX PIN authentication is separate from browser permission.

```ts
import { requestBluetooth, systemVersion } from "@v5x/serial"

const device = await requestBluetooth()
if (!(await device.isPaired())) {
  await device.requestPairing()
  // Obtain the four displayed digits through your application's UI.
  await device.authenticatePairing(Uint8Array.of(1, 2, 3, 4))
}
console.log(await device.connection.request(systemVersion()))
await device.connection.close()
```

`openBluetooth(device)` opens an already selected browser device. `getBluetoothDevices()` returns previously granted devices where the browser implements that API. BLE uses the upstream system, user, and pairing characteristics. System commands are limited to 244 bytes. File transfers choose aligned chunks that fit the negotiated transfer window and BLE packet limit, and do not wait for BLE file-write acknowledgements.

## Stdio and commands

```ts
import { readUser, writeUser, captureScreen } from "@v5x/serial"

const unsubscribe = connection.onUserData((bytes) => console.log(bytes))
await writeUser(connection, new TextEncoder().encode("hello\n"))
// Without a separate serial user port, poll the system-port FIFO.
const bytes = await readUser(connection)
const image = await captureScreen(connection) // 480 × 272 RGBA
unsubscribe()
```

User notifications deliver raw bytes on BLE and on a separate serial user port. Without a user port, `readUser` polls once and can return an empty array. `writeUser` uses the CDC FIFO fallback with 224-byte chunks; that fallback cannot transmit NUL bytes. Use a streaming `TextDecoder` when decoding output split across notifications.

The package includes CDC/CDC2 framing, VarU16, CRC16/CRC32, command matching, timeout retries, system status/version/flags, key-value commands, file metadata and directories, run/stop, upload/download, monolithic and hot/cold program uploads, gzip, screen capture, and mock touch. Slots are 1–8. File transfers report percentages from 0 to 100. Handshakes serialize automatically, but callers must await a complete file/program transfer before starting another operation on the same connection, since VEXos has one active transfer session.

Low-level `cdc`, `cdc2`, `cmds`, and `ecmds` provide access to all upstream command numbers. For example, `connection.request(cdc2(ecmds.LOG_STATUS))` returns the raw payload. Specialized controller, factory, AI Vision, and other non-V5 payload structures have not been translated into typed command helpers. Supply their binary payloads and a decoder through `cdc` or `cdc2` as needed. An omitted CDC payload emits no length field; CDC2 commands always include their payload length and CRC.

`connection.request(command, { timeout: 500, retries: 5 })` uses milliseconds and retries timeouts only. NACKs, corrupt packets, transport errors, and disconnects reject immediately. Close connections to release serial stream locks and BLE subscriptions. A disconnected connection must be reopened.

Web Serial and Web Bluetooth require browser support, permission, and a secure context such as HTTPS or localhost. Gzip uses `CompressionStream`. Automated tests use browser API fakes; physical V5 hardware validation is still required.

## Checks

```sh
bun run --cwd packages/serial typecheck
bun run --cwd packages/serial test
```

## Brain event log

`logStatus()` returns the recorded event count. `logRead(offset, count)` reads event records using the upstream VEXos packet layout. For the latest 20 records, request `logRead(Math.min(count, 20), Math.min(count, 20))`. Each record contains `code`, `type`, `description`, `spare`, and `time` in milliseconds since boot. Upstream leaves the event-code meanings undocumented, so consumers should display raw values rather than assign guessed descriptions.

The editor's Robot console opens from the rightmost actions-bar button. It shares the upload connection, reads USB FIFO output or Bluetooth notifications, sends newline-terminated commands, and provides run/stop controls and a manual event-log refresh. Device operations pause console requests during uploads. Console output stays in browser memory and is limited to 200,000 characters. Hardware validation is still required.

Hot/cold uploads require both non-empty packages. Following [PROS CLI](https://github.com/purduesigbots/pros-cli/blob/develop/pros/serial/devices/vex/v5_device.py), the cold library is stored in vendor namespace `0x18` at `0x03800000`; the slot binary links to it and loads at `0x07800000`. The library uploads first, then the running program stops before the INI and hot binary are replaced. Matching library size and CRC skip the cold transfer. Compression defaults to gzip and can be disabled.

Library names use the first 128 bits of a SHA-256 hash of the cold binary, encoded as URL-safe base64. PROS CLI derives names from project template metadata, which this binary-only API does not receive. This implementation does not evict old libraries automatically.
