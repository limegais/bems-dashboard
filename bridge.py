import asyncio
import websockets

MQTT_HOST = "128.199.206.166"
MQTT_PORT = 1883
WS_PORT = 9001

async def forward_ws_to_tcp(websocket, writer):
    try:
        async for message in websocket:
            if isinstance(message, str):
                message = message.encode("utf-8")
            writer.write(message)
            await writer.drain()
    except Exception as e:
        pass
    finally:
        writer.close()

async def forward_tcp_to_ws(reader, websocket):
    try:
        while True:
            data = await reader.read(4096)
            if not data:
                break
            await websocket.send(data)
    except Exception as e:
        pass
    finally:
        await websocket.close()

async def handler(websocket, *args, **kwargs):
    print(f"[Bridge] New WebSocket client connected: {websocket.remote_address}")
    try:
        reader, writer = await asyncio.open_connection(MQTT_HOST, MQTT_PORT)
        print(f"[Bridge] Connected to MQTT broker {MQTT_HOST}:{MQTT_PORT}")
        await asyncio.gather(
            forward_ws_to_tcp(websocket, writer),
            forward_tcp_to_ws(reader, websocket),
        )
    except Exception as e:
        print(f"[Bridge] Connection error: {e}")
    finally:
        print(f"[Bridge] Client disconnected: {websocket.remote_address}")

async def main():
    print(f"[Bridge] Starting WebSocket-to-MQTT proxy on ws://0.0.0.0:{WS_PORT} -> {MQTT_HOST}:{MQTT_PORT}...")
    async with websockets.serve(handler, "0.0.0.0", WS_PORT, subprotocols=["mqtt"]):
        await asyncio.Future()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("[Bridge] Stopped.")
