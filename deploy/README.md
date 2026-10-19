# Deploy ReCast lên VPS Linux

ReCast chạy trên một VPS Linux, Caddy đứng trước lo HTTPS, app vẫn chỉ nghe `127.0.0.1:5180`. Thiết kế và lý do: `planning/61_2026-10-18_vps-deploy/` (chỉ có ở máy phát triển).

| File | Dùng để |
| --- | --- |
| `Dockerfile.linux-check` | Kiểm build + phát lại esmini trên Linux ở máy dev, không phải image production |
| `Caddyfile` | Reverse proxy HTTPS → 127.0.0.1:5180 |
| `recast.service` | Chạy app bằng systemd, tự khởi động lại |

## 1. Kiểm trên Linux trước (máy dev, cần Docker)

```sh
git ls-files -z -co --exclude-standard | tar --null -T - -c | docker build -f deploy/Dockerfile.linux-check -t recast-linux-check -
docker run --rm recast-linux-check
```

## 2. Dựng VPS (Ubuntu 24.04, ≥2 vCPU / 8 GB RAM / 40 GB)

```sh
# root
apt-get update && apt-get install -y python3.12-venv python3-dev build-essential git curl xz-utils caddy
curl -fsSL https://nodejs.org/dist/v22.23.2/node-v22.23.2-linux-x64.tar.xz | tar -xJ -C /usr/local --strip-components=1
adduser --disabled-password --gecos "" recast

# user recast
git clone <repo> ~/recast && cd ~/recast
python3.12 -m venv backend/.venv
backend/.venv/bin/python -m pip install -e './backend[scenario-build]'
backend/.venv/bin/python backend/scripts/build_scenario_engine.py    # build esmini cho đúng CPU của VPS
cd frontend && npm ci && npm run build && cd ..
```

Upload dữ liệu (từ máy dev): `rsync -a <nuscenes>/v1.0-mini <nuscenes>/maps recast@<vps>:~/datasets/nuscenes/`. nuScenes chỉ dùng phi thương mại, ghi nguồn.

**Tạo tài khoản TRƯỚC khi mở Caddy** (ở chế độ công khai web không cho tạo):

```sh
read -rs P && printf '%s\n' "$P" | node frontend/server/create-account.mjs <ten-dang-nhap>; unset P
```

Mã thoát: `0` xong · `1` sai tên/mật khẩu (mật khẩu 12–128 ký tự) · `2` đã có tài khoản.

Sửa tên miền trong `recast.service` và `Caddyfile` (phải trùng nhau), rồi:

```sh
sudo cp deploy/recast.service /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now recast
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile && sudo systemctl reload caddy
sudo ufw allow 22,80,443/tcp && sudo ufw enable      # KHÔNG mở 5180
```

Mở `https://<tên-miền>`, đăng nhập, **Thêm dữ liệu** với đường dẫn trên VPS (`/home/recast/datasets/nuscenes`).

## 3. Giới hạn

- Một tài khoản dùng chung. 5 lần sai mật khẩu khoá đăng nhập 15 phút cho mọi người; muốn chặn bot thêm thì bật `basic_auth` trong Caddyfile.
- "Xem trên CARLA" tắt trên VPS (cần máy GPU riêng).
- Người đã đăng nhập chọn được thư mục bất kỳ trên VPS làm dữ liệu/workspace — chỉ cấp tài khoản cho người tin cậy.

## 4. Cập nhật / rollback

```sh
cd ~/recast && git pull && (cd frontend && npm ci && npm run build) && sudo systemctl restart recast
sudo systemctl stop recast     # gỡ nhanh: Caddy trả 502, dữ liệu giữ nguyên
```
