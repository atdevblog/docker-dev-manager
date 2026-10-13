# Docker Dev Manager

[English](README.md) · **Tiếng Việt**

Dashboard web chạy trên máy để quản lý các dự án Docker Compose. Nó tự tìm mọi dự án, chấm điểm sức khỏe Docker và cho biết việc nào cần làm trước, khởi động và dừng dự án (từng dự án hoặc theo nhóm), giải thích vì sao một dự án không chạy, và giúp bạn giải phóng bộ nhớ, chọn port trống, dọn ổ đĩa an toàn. Công cụ bổ trợ cho Docker Desktop chứ không thay thế nó.

![Docker Dev Manager](docs/images/vi-overview.png)

- **Không cần cài đặt gì thêm:** chỉ cần Node.js, không có dependency npm, không cần database.
- **Dùng ngay với dự án sẵn có:** tự phát hiện qua label của Docker, không cần import, không di chuyển file nào.
- **An toàn mặc định:** mọi thao tác đều được kiểm tra trước; không có gì bị xóa hay dừng tự động.
- **Giao diện Tiếng Việt / English.**

📖 **[Hướng dẫn sử dụng](docs/guide.vi.md)** · [User guide](docs/guide.en.md)

## Yêu cầu

- Node.js **20 trở lên**
- Docker Desktop, hoặc Docker Engine kèm plugin `docker compose` v2, đang chạy
- macOS hoặc Linux. Việc mở thư mục bằng Finder/Terminal/VS Code và thẻ bộ nhớ "Máy Mac này" dùng công cụ của macOS; các phần còn lại chạy được trên Linux.

## Cài đặt và chạy

```bash
git clone https://github.com/atdevblog/docker-dev-manager.git
cd docker-dev-manager
npm start
```

Mở **http://localhost:4173**. Tắt bằng `Ctrl+C`.

| Biến môi trường | Mặc định | Công dụng |
|---|---|---|
| `DEV_MANAGER_PORT` | `4173` | Port của dashboard (luôn chỉ bind `127.0.0.1`) |
| `DEV_MANAGER_CONFIG_DIR` | `~/.config/docker-dev-manager` | Nơi lưu cài đặt |
| `DEV_MANAGER_IDLE_MINUTES` | `15` | Thời gian một dự án đang chạy phải im lặng (không traffic mạng, CPU < 1%) trước khi được coi là nhàn rỗi |

Ví dụ: `DEV_MANAGER_PORT=4174 npm start`. Muốn dashboard vẫn chạy sau khi đóng terminal, dùng trình quản lý tiến trình quen thuộc của bạn, hoặc `nohup npm start >/tmp/docker-dev-manager.log 2>&1 &`.

## Bạn có thể làm gì

| | |
|---|---|
| **Tổng quan trong một hàng** | Năm thẻ ở đầu trang: điểm sức khỏe Docker, số dự án đang chạy, RAM container so với giới hạn của Docker VM, bộ nhớ máy Mac kèm áp lực bộ nhớ và swap, và dung lượng ổ đĩa thu hồi được. Bấm vào thẻ để đến phần chi tiết. |
| **Sức khỏe & tư vấn tài nguyên** | Ba cột trả lời *Docker đang có vấn đề gì*, *lãng phí ở đâu* và *nên làm gì ngay*. Điểm sức khỏe chỉ gồm các khoản trừ có giải thích. Việc cần làm được xếp theo mức **Khẩn cấp → Quan trọng → Nên làm → Tối ưu**, việc nghiêm trọng nhất lên đầu, mỗi việc kèm ước tính RAM/ổ đĩa giải phóng và mức rủi ro. |
| **Dự án** | Xem mọi dự án Compose cùng trạng thái, RAM và vấn đề. Khởi động, dừng, khởi động lại và xem nhật ký mà không cần import. |
| **Vì sao không chạy** | Crash loop, mã thoát được giải thích dễ hiểu, bị kill vì hết bộ nhớ, container unhealthy, lỗi khởi động, mỗi dòng có nút mở nhật ký. |
| **Thao tác an toàn** | Kiểm tra trước khi chạy: port bị container khác chiếm sẽ chặn thao tác, và các dự án phụ thuộc nhau qua network dùng chung được chỉ ra. |
| **Nhóm từ Docker** | Khi một dự án dùng network của dự án khác (ví dụ ứng dụng và stack database hoặc proxy của nó), chúng tự thành một nhóm. Khởi động hoặc dừng cả nhóm chỉ với một thao tác, đúng thứ tự phụ thuộc, có bước xem lại trước. |
| **Giải phóng bộ nhớ** | Các dự án đang chạy sắp theo bộ nhớ, kèm ghi chú nếu dừng chúng sẽ làm hỏng gì. Hạ tầng dùng chung có thể đánh dấu *luôn chạy*. |
| **Port** | Port nào trên máy đã bị chiếm, port nào được dự án đã dừng giữ chỗ, và port trống gần nhất. |
| **Ổ đĩa** | Docker đang dùng bao nhiêu ổ đĩa, phân loại *dọn an toàn*, *cần xem lại* hoặc *có thể chứa dữ liệu*, kèm lệnh để sao chép. Dashboard không tự xóa gì. |

## Ảnh màn hình

![Sức khỏe & tư vấn tài nguyên](docs/images/vi-advisor.png)

<table>
<tr>
<td width="50%"><b>Dự án và nhóm từ Docker</b><br><img src="docs/images/vi-projects.png" alt="Thẻ dự án kèm vấn đề và nhóm"></td>
<td width="50%"><b>Giải phóng bộ nhớ</b><br><img src="docs/images/vi-memory.png" alt="Dự án đang chạy sắp theo bộ nhớ"></td>
</tr>
<tr>
<td width="50%"><b>Port</b><br><img src="docs/images/vi-ports.png" alt="Port đã chiếm, được giữ chỗ và còn trống"></td>
<td width="50%"><b>Ổ đĩa</b><br><img src="docs/images/vi-disk.png" alt="Dung lượng ổ đĩa phân loại theo rủi ro"></td>
</tr>
</table>

[Hướng dẫn sử dụng](docs/guide.vi.md) đi qua chi tiết từng màn hình.

## File cài đặt

Cài đặt được lưu ở `~/.config/docker-dev-manager/projects.json`. File chỉ được tạo khi bạn lưu một thứ gì đó: dự án đã import, *luôn chạy* hoặc ngôn ngữ.

```json
{
  "projects":    [{"name": "billing", "directory": "/Users/you/Projects/billing", "composeFile": "compose.yaml", "description": "Payments service"}],
  "keepRunning": ["infra"],
  "language":    "vi"
}
```

File được ghi atomic với quyền `0600`, giữ nguyên các key khác. File bị hỏng không bao giờ bị ghi đè.

## Bảo mật

Đây là **công cụ cục bộ cho một người dùng**. Nó chỉ lắng nghe ở `127.0.0.1`, từ chối request có `Host` không phải `localhost`, và yêu cầu token theo phiên cùng `Origin` localhost cho mọi thay đổi. Lệnh chạy bằng quyền Docker của chính bạn. Không mở công cụ ra mạng hay qua tunnel.

<details>
<summary>Tùy chọn: mở bằng tên miền cục bộ qua reverse proxy</summary>

Proxy chạy trên cùng máy và chính nó chỉ bind `127.0.0.1` sẽ dùng được, nếu đổi `Host` và `Origin` về localhost. Ví dụ với nginx:

```nginx
map $http_origin $ddm_origin { default $http_origin; "~^https?://docker-dev\.localhost$" "http://localhost:4173"; }
server {
    listen 127.0.0.1:80;
    server_name docker-dev.localhost;
    location / {
        proxy_pass http://127.0.0.1:4173;
        proxy_set_header Host localhost:4173;
        proxy_set_header Origin $ddm_origin;
        proxy_read_timeout 180s;
    }
}
```
</details>

## Xử lý sự cố

| Vấn đề | Cách xử lý |
|---|---|
| *Không thể kết nối Docker Engine* | Mở Docker Desktop rồi bấm **Làm mới**. |
| Thiếu một dự án | Chỉ phát hiện được dự án còn container. Bấm **Quét Docker**, hoặc **Thêm thủ công**. |
| Báo `EADDRINUSE` khi chạy | Port 4173 đã bị dùng: `DEV_MANAGER_PORT=4174 npm start`. |
| Không có số liệu CPU/RAM | Kiểm tra `docker stats --no-stream` có chạy được trong terminal không. |

## Phát triển

```
server.js            HTTP server, gọi Docker CLI, kiểm tra trước, tác vụ nền
lib/analysis.js      luật thuần: gom nhóm, vấn đề, phụ thuộc, port, tài nguyên, ổ đĩa
lib/advisor.js       điểm sức khỏe, lãng phí và khuyến nghị xếp theo thứ tự
public/              trang web (index.html, app.js, style.css), i18n.js, locales/, icon
assets/icons/        file nguồn icon; build.sh tạo lại favicon.ico và apple-touch-icon.png
docs/                hướng dẫn sử dụng (en, vi) và ảnh chụp
test/                các bộ test node:test
```

- `npm test` chạy unit test, HTTP test và test bản dịch. Không thay đổi trạng thái Docker và dùng thư mục cài đặt tạm.
- `npm run test:docker` là test tùy chọn trên Docker Engine thật. Nó tạo các dự án tạm `ddmit*` (image `nginx:alpine`, port 47391) rồi xóa sau khi xong.
- **Chữ và ngôn ngữ:** mọi chuỗi hiển thị nằm trong `public/locales/en.json` và `vi.json`; server gửi thông điệp `{key, params}`, không bao giờ gửi câu hoàn chỉnh. Thêm key vào cả hai file và tham chiếu bằng literal (`t('nhom.key')`, `A.msg('nhom.key', …)` hoặc `data-i18n="nhom.key"`). `npm test` sẽ báo lỗi khi key bị thiếu, không dùng hoặc không khớp.
- **Cách thao tác chạy:**
  - Khởi động, Dừng, Khởi động lại và Nhật ký dùng `docker compose -p <tên> <lệnh>` dựa trên label của container. Cách này không cần file Compose và giữ đúng thứ tự `depends_on`. Lệnh chạy trong một thư mục rỗng để Compose không nạp nhầm file của dự án khác.
  - Up và Down dùng file Compose của dự án đã import.

## Giấy phép

[MIT](LICENSE). Dự án không liên kết với và không được Docker, Inc. bảo trợ. Docker là nhãn hiệu của Docker, Inc.
