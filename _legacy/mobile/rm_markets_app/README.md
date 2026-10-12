# RM Markets Flutter Mobile App

## Setup

1. From `mobile/rm_markets_app`, run:
   - `flutter pub get`
2. Start backend first (Docker Compose in `infra`).
3. Run app in emulator:
   - `flutter run`

## Features implemented

- Auth login/register using `auth-service`.
- Local JWT storage with `flutter_secure_storage`.
- Basic home screen with auth status.

## Next work

- Add live market feed screen with WebSocket to `market-service`.
- Add portfolio/trading screens.
- Add charts via `syncfusion_flutter_charts`.
