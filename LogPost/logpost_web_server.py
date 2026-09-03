# udp_log_receiver.py
# Python 3.x

import socket
from pathlib import Path


LISTEN_HOST = "0.0.0.0"
LISTEN_PORT = 19090

OUTPUT_LOG_FILE = Path(__file__).resolve().parent / "SquadGame.log"


def main():
    output_path = Path(OUTPUT_LOG_FILE)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind((LISTEN_HOST, LISTEN_PORT))

    print(f"[Receiver] Listening on {LISTEN_HOST}:{LISTEN_PORT}")
    print(f"[Receiver] Writing to {output_path}")

    with output_path.open("ab") as f:
        while True:
            data, addr = sock.recvfrom(65535)

            if not data:
                continue

            f.write(data)
            f.flush()

            print(f"[Receiver] {len(data)} bytes from {addr}")
            print(data)

if __name__ == "__main__":
    main()
