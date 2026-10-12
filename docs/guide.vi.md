# Docker Dev Manager — Hướng dẫn sử dụng

[English](guide.en.md) · **Tiếng Việt** · [Về README](../README.vi.md)

Docker Dev Manager là một trang web chạy trên máy của bạn, dùng để quản lý các dự án Docker Compose trên máy. Nó tự tìm các dự án, khởi động và dừng chúng, giải thích vì sao một dự án không chạy, và giúp bạn giải phóng bộ nhớ, chọn port trống, dọn ổ đĩa an toàn.

> Ảnh chụp dùng dữ liệu demo.

## Mục lục

1. [Cài đặt và mở](#1-cài-đặt-và-mở)
2. [Tổng quan màn hình](#2-tổng-quan-màn-hình)
3. [Khởi động, dừng, khởi động lại](#3-khởi-động-dừng-khởi-động-lại)
4. [Vì sao dự án không chạy?](#4-vì-sao-dự-án-không-chạy)
5. [Xem nhật ký](#5-xem-nhật-ký)
6. [Nhóm từ Docker](#6-nhóm-từ-docker)
7. [Giải phóng bộ nhớ](#7-giải-phóng-bộ-nhớ)
8. [Chọn port trống](#8-chọn-port-trống)
9. [Dọn ổ đĩa an toàn](#9-dọn-ổ-đĩa-an-toàn)
10. [Import dự án, Up và Down](#10-import-dự-án-up-và-down)
11. [Ngôn ngữ](#11-ngôn-ngữ)
12. [Câu hỏi và sự cố thường gặp](#12-câu-hỏi-và-sự-cố-thường-gặp)

## 1. Cài đặt và mở

Cần có **Node.js 20+** và **Docker Desktop** (hoặc Docker Engine kèm `docker compose` v2) đang chạy.

```bash
git clone https://github.com/atdevblog/docker-dev-manager.git
cd docker-dev-manager
npm start
```

Không cần cài thêm gì vì dự án không có dependency npm nào. Mở **http://localhost:4173**. Giữ terminal mở trong lúc dùng, nhấn `Ctrl+C` để tắt. Muốn dùng port khác: `DEV_MANAGER_PORT=4174 npm start`.

## 2. Tổng quan màn hình

![Tổng quan](images/vi-overview.png)

- **Thanh bên:** chuyển nhanh tới Dự án, Tài nguyên, Port, Ổ đĩa. Chấm màu ở dưới cùng cho biết có kết nối được Docker Engine hay không.
- **Header:** chuyển ngôn ngữ (*Tiếng Việt / English*), **Làm mới**, và **Thêm thủ công** cho dự án chưa có container.
- **Thẻ tổng quan:**
  - *Container Docker*: RAM container đang dùng so với dung lượng VM của Docker Desktop, và CPU tính theo nhân.
  - *Máy Mac này*: bộ nhớ đã dùng (tính như Activity Monitor), swap, CPU và áp lực bộ nhớ của macOS. Thẻ chuyển vàng hoặc đỏ khi máy thiếu bộ nhớ.
- **Bộ lọc:** Tất cả, Đang chạy, *Cần chú ý* (dự án có vấn đề), Được quản lý, Được phát hiện, kèm ô tìm kiếm.
- **Nhóm từ Docker:** các dự án đi cùng nhau, được phát hiện tự động, với nút ▶ khởi động và ■ dừng (xem [mục 6](#6-nhóm-từ-docker)).
- **Card dự án:** mỗi dự án Compose tìm thấy từ Docker là một card.
  - Trạng thái: *Đang chạy*, *Chạy một phần*, *Đã dừng*.
  - *Được phát hiện* là tự tìm thấy; *Được quản lý* là bạn đã import hoặc thêm thủ công (chỉ cần cho Up/Down).
  - `N nguồn` nghĩa là cùng một tên dự án được chạy từ nhiều thư mục hoặc bộ file khác nhau.
  - ★ *luôn chạy* đánh dấu hạ tầng dùng chung mà bạn không muốn lỡ tay dừng.
  - Các dòng đỏ hoặc vàng giải thích vấn đề, mỗi dòng có liên kết **Nhật ký**.

Mọi thứ tự làm mới mỗi 15 giây khi trang đang mở.

## 3. Khởi động, dừng, khởi động lại

Dùng các nút trên mỗi card:

| Nút | Tác dụng | Dữ liệu của bạn |
|---|---|---|
| **▶ Khởi động** | Chạy lại các container sẵn có của dự án (`docker compose start`). Không bao giờ tạo lại container. | Giữ nguyên |
| **■ Dừng** | Dừng các container (`docker compose stop`). | Giữ container và volume |
| **↻ Khởi động lại** | Khởi động lại các container. | Giữ nguyên |

Trước mỗi thao tác, dashboard đều kiểm tra trước. Nếu không có vấn đề, thao tác chạy ngay. Nếu có, một cửa sổ xem lại sẽ mở ra:

![Xem lại trước khi dừng](images/vi-stop-review.png)

- Thông báo **đỏ** chặn thao tác, vì Docker chắc chắn sẽ lỗi. Ví dụ *"Port 5432 mà db cần đang bị container … chiếm"*: thông báo nêu rõ container cần dừng hoặc port cần đổi.
- Thông báo **vàng** là cảnh báo, bạn có thể chấp nhận. Trong ví dụ, dự án khác đang dùng network của `infra`, nên dừng `infra` sẽ làm chúng gián đoạn.
- Các dự án liên quan hiện ở trạng thái **chưa tick**. Tick vào nếu muốn đưa vào; mặc định không có gì ngoài lựa chọn của bạn được chạy.
- Dự án mà dự án khác đang chạy vẫn còn dùng, hoặc được bạn đánh dấu *luôn chạy*, cũng **không được tick sẵn**, như trong ví dụ. Muốn dừng nó, bạn phải tự chọn.

## 4. Vì sao dự án không chạy?

Card đã liệt kê các vấn đề quan trọng nhất. Bấm **Chi tiết** để xem đầy đủ:

![Chi tiết dự án](images/vi-details.png)

- **Cần chú ý** giải thích từng vấn đề bằng lời dễ hiểu:
  - *tự khởi động lại N lần*: crash loop. Tiến trình liên tục lỗi, thường vì một dịch vụ nó cần (database, cache) đang dừng.
  - *đã thoát với mã N*: các mã phổ biến đều được giải thích, ví dụ 255 khi Docker Desktop dừng, 137 khi container bị kill, 1 khi ứng dụng lỗi.
  - *bị kill vì hết bộ nhớ (OOM)*: container hết bộ nhớ.
  - *unhealthy* và *khởi động thất bại*: hiển thị lý do gốc của Docker.
- **Container** liệt kê từng service với trạng thái, mã thoát, số lần restart, health, port, giới hạn tài nguyên, kèm liên kết **Nhật ký**.
- **Phụ thuộc / Được dùng bởi** cho biết liên kết với dự án khác qua network Docker dùng chung.
- **Làm bằng terminal** có sẵn đúng các lệnh để sao chép.
- **Finder / Terminal / VS Code** mở thư mục dự án (macOS).

Container có restart policy `unless-stopped` hoặc `always` mà đang dừng thì đã được dừng có chủ đích, nên không bị báo là vấn đề.

## 5. Xem nhật ký

Bấm **Nhật ký** trên card, hoặc **Nhật ký** bên cạnh một vấn đề để mở thẳng đúng service đó.

![Nhật ký](images/vi-logs.png)

- Chọn **Service** hoặc *Tất cả service*, và 150 hoặc 500 **Số dòng**.
- **Chỉ lỗi** giữ lại các dòng chứa từ như *error*, *fatal*, *exception*, *refused*, *killed*.
- **Sao chép lệnh CLI** sao chép lệnh `docker compose … logs -f` tương ứng để theo dõi trực tiếp trong terminal.

Nội dung nhật ký luôn được hiển thị đúng như Docker trả về.

## 6. Nhóm từ Docker

Docker đã gom container thành dự án Compose; mỗi card là một dự án. Nhóm ở cấp cao hơn: gom các **dự án cần nhau**. Bạn không cần tạo nhóm, vì nhóm lấy từ Docker.

Khi container của một dự án dùng network do dự án khác tạo (`external` network trong Compose), thường là ứng dụng dùng chung stack database hoặc proxy, dashboard tự tạo một nhóm mang tên ứng dụng đó. Nhóm gồm ứng dụng và mọi dự án nó cần. Trong ảnh, `blog` và `storefront` đều dùng network của `infra`, nên có hai nhóm: *blog cùng infra* và *storefront cùng infra*. Dự án không cần dự án nào khác thì không có nhóm; card của chính nó là đủ.

1. Bấm **▶** trên nhóm để khởi động mọi thứ ứng dụng cần. Luôn có cửa sổ xem lại liệt kê từng container sẽ bị tác động; dự án đã chạy sẵn được bỏ qua:

![Xem lại khi khởi động nhóm](images/vi-group-start.png)

2. Bấm **■** để dừng nhóm. Dự án dùng chung sẽ không được tick nếu dự án khác đang chạy vẫn còn dùng nó.
3. Các dự án chạy lần lượt; dự án mà dự án khác phụ thuộc vào sẽ khởi động trước và dừng sau cùng. **Hủy phần còn lại** dừng trước khi sang dự án kế tiếp.

Nhóm tự cập nhật khi file Compose của bạn thay đổi network.

## 7. Giải phóng bộ nhớ

Mở **Tài nguyên** ở thanh bên, hoặc bấm vào thẻ *Container Docker*.

![Giải phóng bộ nhớ](images/vi-memory.png)

- Các dự án đang chạy được liệt kê theo mức chiếm bộ nhớ giảm dần, kèm bộ nhớ, CPU và thời gian đã chạy.
- **Ghi chú** cho biết điều cần lưu ý: crash loop, *"… đang chạy và dùng network của dự án này"* (dừng nó sẽ làm hỏng dự án khác), hoặc *luôn chạy*.
- Tick những dự án chưa cần dùng rồi bấm **Dừng N dự án**. Cửa sổ xem lại sẽ mở trước khi dừng bất cứ thứ gì.
- Để bảo vệ hạ tầng dùng chung, mở **Chi tiết** của nó và bấm **★ Luôn chạy**. Dự án đó sẽ không còn chọn được ở đây.

Không có gì bị dừng tự động. CPU thấp không có nghĩa là dự án không được dùng, nên dashboard không bao giờ gọi nó là nhàn rỗi. **Tất cả container đang chạy** hiển thị số liệu theo từng container.

## 8. Chọn port trống

Mở **Port** trước khi gán port cho dự án mới.

![Port](images/vi-ports.png)

- **Kiểm tra:** nhập một hoặc nhiều port (ví dụ `5432 3000`). Kết quả cho biết port *trống*, hoặc ai đang giữ nó kèm các port trống gần nhất.
- **Port mặc định phổ biến** cho thấy ngay các port quen thuộc (80, 3000, 3306, 5432, 6379, 8080…) đã bị chiếm chưa và port trống kế tiếp.
- **Theo dự án** gom port theo chủ sở hữu; **Theo số port** là bảng sắp xếp theo số.
  - Xanh lá: container đang chạy giữ port.
  - Vàng, *giữ chỗ*: một container **đã dừng** sẽ cần port này khi khởi động lại. Dùng port này cho dự án mới sẽ khiến lần khởi động đó thất bại.
  - Xanh dương: chương trình khác trên máy. Trên macOS, AirPlay Receiver dùng port 5000 và 7000.
  - *mọi địa chỉ* nghĩa là máy khác trong mạng LAN có thể truy cập port đó.

Port từ 49152 trở lên do macOS cấp ngẫu nhiên nên không bao giờ được gợi ý.

## 9. Dọn ổ đĩa an toàn

Mở **Ổ đĩa** và bấm **Phân tích ổ đĩa** (mất vài giây).

![Dung lượng ổ đĩa](images/vi-disk.png)

| Mức rủi ro | Ý nghĩa |
|---|---|
| **Dọn an toàn** | Build cache và image dangling: chỉ làm lần build sau chậm hơn. Sao chép lệnh gợi ý và chạy trong terminal. |
| **Cần xem lại** | Image có tag nhưng không dùng (phải pull hoặc build lại) và container đã dừng (mất nhật ký của chúng). |
| **Có thể chứa dữ liệu** | Volume không container nào dùng. Có thể chứa database nên chỉ được liệt kê, kèm dự án đã tạo ra nó. |

Dashboard không bao giờ tự xóa bất cứ thứ gì.

## 10. Import dự án, Up và Down

**Khởi động**, **Dừng**, **Khởi động lại** và **Nhật ký** dùng được cho mọi dự án mà không cần import. Bạn chỉ cần import để dùng:

- **Up:** tạo hoặc tạo lại container từ file Compose, ví dụ sau khi `Down` hoặc sau khi sửa file.
- **Down:** xóa container và network của dự án. Volume có tên được giữ lại.

Để import, mở **Chi tiết** và bấm **＋ Import dự án**. Nút này xuất hiện khi Docker biết chính xác một file Compose duy nhất của dự án. Nếu không có nút này, bấm **＋ Thêm thủ công** trên header và nhập:

- tên dự án;
- thư mục (đường dẫn tuyệt đối);
- tên file Compose, tương đối so với thư mục (ví dụ `docker-compose.yml`).

Up luôn hiện cửa sổ xem lại trước, và kiểm tra file Compose cùng port. Down luôn yêu cầu xác nhận.

## 11. Ngôn ngữ

Dùng nút **Tiếng Việt / English** trên header. Trang chuyển ngay và ghi nhớ lựa chọn, kể cả sau khi khởi động lại. Tên dự án, container, đường dẫn, port và nội dung nhật ký không bao giờ bị dịch.

## 12. Câu hỏi và sự cố thường gặp

| Vấn đề | Cách xử lý |
|---|---|
| *Không thể kết nối Docker Engine* | Mở Docker Desktop, chờ chạy xong rồi bấm **Làm mới**. |
| Thiếu một dự án | Chỉ tìm được dự án còn container. Bấm **Quét Docker**, hoặc **Thêm thủ công**. |
| Khởi động bị chặn | Đọc thông báo đỏ: nó nêu container đang giữ port hoặc network bị thiếu. |
| Badge `N nguồn` | Tên dự án được chạy từ các thư mục hoặc bộ file Compose khác nhau. Chi tiết liệt kê từng nguồn; Khởi động/Dừng tác động lên tất cả. |
| Port 4173 đã bị dùng | Chạy `DEV_MANAGER_PORT=4174 npm start`. |
| Không có số liệu CPU/RAM | Chạy `docker stats --no-stream` trong terminal để kiểm tra Docker. |
