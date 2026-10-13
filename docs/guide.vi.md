# Docker Dev Manager — Hướng dẫn sử dụng

[English](guide.en.md) · **Tiếng Việt** · [Về README](../README.vi.md)

Docker Dev Manager là một trang web chạy trên máy của bạn, dùng để quản lý các dự án Docker Compose trên máy. Nó tự tìm các dự án, khởi động và dừng chúng, giải thích vì sao một dự án không chạy, và giúp bạn giải phóng bộ nhớ, chọn port trống, dọn ổ đĩa an toàn.

> Ảnh chụp dùng dữ liệu demo.

## Mục lục

1. [Cài đặt và mở](#1-cài-đặt-và-mở)
2. [Tổng quan màn hình](#2-tổng-quan-màn-hình)
3. [Sức khỏe & tư vấn tài nguyên](#3-sức-khỏe--tư-vấn-tài-nguyên)
4. [Khởi động, dừng, khởi động lại](#4-khởi-động-dừng-khởi-động-lại)
5. [Vì sao dự án không chạy?](#5-vì-sao-dự-án-không-chạy)
6. [Xem nhật ký](#6-xem-nhật-ký)
7. [Nhóm từ Docker](#7-nhóm-từ-docker)
8. [Giải phóng bộ nhớ](#8-giải-phóng-bộ-nhớ)
9. [Chọn port trống](#9-chọn-port-trống)
10. [Dọn ổ đĩa an toàn](#10-dọn-ổ-đĩa-an-toàn)
11. [Import dự án, Up và Down](#11-import-dự-án-up-và-down)
12. [Ngôn ngữ](#12-ngôn-ngữ)
13. [Câu hỏi và sự cố thường gặp](#13-câu-hỏi-và-sự-cố-thường-gặp)

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
- **Thẻ tổng quan** (bấm vào một thẻ để tới đúng mục liên quan):
  - *Sức khỏe Docker*: điểm sức khỏe trên 100 của mục tư vấn kèm trạng thái (Khỏe, Cần chú ý, Không ổn), số vấn đề và phiên bản Docker. Thẻ chuyển đỏ khi mất kết nối Docker Engine.
  - *Dự án đang chạy*: số đang chạy trên tổng số, kèm số container và số dự án cần chú ý.
  - *RAM container*: RAM container đang dùng so với dung lượng VM của Docker Desktop (có thanh đo), CPU tính theo nhân, và dự án ngốn nhiều nhất.
  - *Bộ nhớ máy Mac*: bộ nhớ đã dùng (tính như Activity Monitor) trên tổng, thanh đo đổi màu theo áp lực bộ nhớ của macOS, kèm swap và CPU. Swap lớn được làm nổi bật khi máy thiếu bộ nhớ.
  - *Ổ đĩa thu hồi được*: phần dọn được an toàn, cộng phần cần xem lại trước.
- **Bộ lọc:** Tất cả, Đang chạy, *Cần chú ý* (dự án có vấn đề), Được quản lý, Được phát hiện, kèm ô tìm kiếm.
- **Sức khỏe & tư vấn tài nguyên:** điểm sức khỏe, lãng phí ở đâu và nên làm gì ngay (xem [mục 3](#3-sức-khỏe--tư-vấn-tài-nguyên)).
- **Nhóm từ Docker:** các dự án đi cùng nhau, được phát hiện tự động, với nút ▶ khởi động và ■ dừng (xem [mục 6](#7-nhóm-từ-docker)).
- **Card dự án:** mỗi dự án Compose tìm thấy từ Docker là một card.
  - Trạng thái: *Đang chạy*, *Chạy một phần*, *Đã dừng*.
  - *Được phát hiện* là tự tìm thấy; *Được quản lý* là bạn đã import hoặc thêm thủ công (chỉ cần cho Up/Down).
  - `N nguồn` nghĩa là cùng một tên dự án được chạy từ nhiều thư mục hoặc bộ file khác nhau.
  - ★ *luôn chạy* đánh dấu hạ tầng dùng chung mà bạn không muốn lỡ tay dừng.
  - Các dòng đỏ hoặc vàng giải thích vấn đề, mỗi dòng có liên kết **Nhật ký**.

Kéo xuống để xem các card dự án:

![Card dự án](images/vi-projects.png)

Mọi thứ tự làm mới mỗi 15 giây khi trang đang mở.

## 3. Sức khỏe & tư vấn tài nguyên

![Sức khỏe & tư vấn tài nguyên](images/vi-advisor.png)

Mục tư vấn nằm ngay dưới các thẻ tổng quan và trả lời ba câu hỏi. Nó tự làm mới mỗi 30 giây; bấm **Kiểm tra lại** để cập nhật ngay.

**Docker đang có vấn đề gì?** Điểm sức khỏe bắt đầu từ 100. Mỗi vấn đề trừ một số điểm cố định, không phải con số tùy ý, và mỗi dòng cho biết nguyên nhân, cách xử lý cùng một nút (mở nhật ký, xem lại & khởi động, chi tiết…). Rê chuột lên dòng để xem giải thích gốc của Docker. 90–100 là *Khỏe*, 70–89 *Cần chú ý*, dưới 70 *Không ổn*. Mục *Cách tính điểm* liệt kê mọi luật:

| Vấn đề | Điểm | Tối đa |
|---|---|---|
| Không kết nối được Docker Engine | −100 | |
| Crash loop | −15 mỗi lỗi | −45 |
| Hết bộ nhớ khi đang chạy | −12 mỗi lỗi | −36 |
| Container unhealthy / khởi động thất bại | −10 mỗi lỗi | −30 mỗi loại |
| Container dùng từ 90% giới hạn RAM của chính nó | −8 mỗi lỗi | −24 |
| Xung đột port (container đã dừng không khởi động được) / mất network | −6 mỗi lỗi | −18 mỗi loại |
| Service dừng trong khi phần còn lại của dự án vẫn chạy | −5 mỗi lỗi | −15 |
| Hết bộ nhớ ở lần chạy trước | −4 mỗi lỗi | −12 |
| Áp lực bộ nhớ macOS nghiêm trọng / cảnh báo | −20 / −8 | |
| VM Docker dùng từ 90% RAM | −10 | |

**Lãng phí ở đâu?**
- *Dự án nhàn rỗi*: đang chạy nhưng không có traffic mạng và CPU dưới 1% trong ít nhất 15 phút. CPU thấp thôi không bao giờ đủ để coi là nhàn rỗi. Dashboard chỉ đo khi trang đang mở, nên ngay sau khi mở nó sẽ cho biết còn cần quan sát thêm bao nhiêu phút.
- Container tốn CPU vì crash loop.
- Ổ đĩa Docker có thể trả lại (build cache, image dangling và image không dùng, container đã dừng, volume không dùng), mỗi loại kèm mức độ an toàn.

**Nên làm gì ngay?** Danh sách xếp theo mức nghiêm trọng, việc gấp nhất ở trên cùng. Mỗi việc có nhãn mức độ: **Khẩn cấp** (đang hỏng: crash loop, hết bộ nhớ, khởi động thất bại), **Quan trọng** (dịch vụ chập chờn hoặc máy thiếu bộ nhớ), **Nên làm** (dự án nhàn rỗi, sự cố đã qua) và **Tối ưu** (dọn ổ đĩa). Ba cột luôn cao bằng nhau và tự cuộn bên trong, nên trang không bị giật khi advisor làm mới.
- Mỗi việc có ước tính lợi ích (≈ RAM hoặc ổ đĩa), mức rủi ro và một nút. Nút khởi động và dừng luôn mở cửa sổ xem lại như thường lệ; không có gì chạy mà không qua bước này.
- Các dự án nhàn rỗi được gợi ý dừng cùng nhau. Dự án mà chúng cần (database, proxy) chỉ được thêm vào khi nó cũng nhàn rỗi và không dự án nào khác dùng. Khi máy thiếu bộ nhớ (macOS cảnh báo hoặc VM Docker từ 80%), các dự án lớn nhất cũng được gợi ý, kèm nhãn *Cần xem lại* vì chúng đang được dùng.
- Ổ đĩa: các loại an toàn có sẵn lệnh để sao chép; image và volume mở mục Ổ đĩa. Volume không bao giờ bị xóa tự động.
- **Nên giữ chạy** liệt kê các dự án đang chạy nên giữ lại, kèm lý do: đã đánh dấu luôn chạy, đang được dự án khác dùng, đang được dùng, hoặc chưa quan sát đủ lâu.

Muốn đổi ngưỡng nhàn rỗi: `DEV_MANAGER_IDLE_MINUTES=30 npm start`.

## 4. Khởi động, dừng, khởi động lại

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

## 5. Vì sao dự án không chạy?

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

## 6. Xem nhật ký

Bấm **Nhật ký** trên card, hoặc **Nhật ký** bên cạnh một vấn đề để mở thẳng đúng service đó.

![Nhật ký](images/vi-logs.png)

- Chọn **Service** hoặc *Tất cả service*, và 150 hoặc 500 **Số dòng**.
- **Chỉ lỗi** giữ lại các dòng chứa từ như *error*, *fatal*, *exception*, *refused*, *killed*.
- **Sao chép lệnh CLI** sao chép lệnh `docker compose … logs -f` tương ứng để theo dõi trực tiếp trong terminal.

Nội dung nhật ký luôn được hiển thị đúng như Docker trả về.

## 7. Nhóm từ Docker

Docker đã gom container thành dự án Compose; mỗi card là một dự án. Nhóm ở cấp cao hơn: gom các **dự án cần nhau**. Bạn không cần tạo nhóm, vì nhóm lấy từ Docker.

Khi container của một dự án dùng network do dự án khác tạo (`external` network trong Compose), thường là ứng dụng dùng chung stack database hoặc proxy, dashboard tự tạo một nhóm mang tên ứng dụng đó. Nhóm gồm ứng dụng và mọi dự án nó cần. Trong ảnh, `blog` và `storefront` đều dùng network của `infra`, nên có hai nhóm: *blog cùng infra* và *storefront cùng infra*. Dự án không cần dự án nào khác thì không có nhóm; card của chính nó là đủ.

1. Bấm **▶** trên nhóm để khởi động mọi thứ ứng dụng cần. Luôn có cửa sổ xem lại liệt kê từng container sẽ bị tác động; dự án đã chạy sẵn được bỏ qua:

![Xem lại khi khởi động nhóm](images/vi-group-start.png)

2. Bấm **■** để dừng nhóm. Dự án dùng chung sẽ không được tick nếu dự án khác đang chạy vẫn còn dùng nó.
3. Các dự án chạy lần lượt; dự án mà dự án khác phụ thuộc vào sẽ khởi động trước và dừng sau cùng. **Hủy phần còn lại** dừng trước khi sang dự án kế tiếp.

Nhóm tự cập nhật khi file Compose của bạn thay đổi network.

## 8. Giải phóng bộ nhớ

Mở **Tài nguyên** ở thanh bên, hoặc bấm vào thẻ *Container Docker*.

![Giải phóng bộ nhớ](images/vi-memory.png)

- Các dự án đang chạy được liệt kê theo mức chiếm bộ nhớ giảm dần, kèm bộ nhớ, CPU và thời gian đã chạy.
- **Ghi chú** cho biết điều cần lưu ý: crash loop, *"… đang chạy và dùng network của dự án này"* (dừng nó sẽ làm hỏng dự án khác), hoặc *luôn chạy*.
- Tick những dự án chưa cần dùng rồi bấm **Dừng N dự án**. Cửa sổ xem lại sẽ mở trước khi dừng bất cứ thứ gì.
- Để bảo vệ hạ tầng dùng chung, mở **Chi tiết** của nó và bấm **★ Luôn chạy**. Dự án đó sẽ không còn chọn được ở đây.

Không có gì bị dừng tự động. CPU thấp không có nghĩa là dự án không được dùng, nên dashboard không bao giờ gọi nó là nhàn rỗi. **Tất cả container đang chạy** hiển thị số liệu theo từng container.

## 9. Chọn port trống

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

## 10. Dọn ổ đĩa an toàn

Mở **Ổ đĩa** và bấm **Phân tích ổ đĩa** (mất vài giây).

![Dung lượng ổ đĩa](images/vi-disk.png)

| Mức rủi ro | Ý nghĩa |
|---|---|
| **Dọn an toàn** | Build cache và image dangling: chỉ làm lần build sau chậm hơn. Sao chép lệnh gợi ý và chạy trong terminal. |
| **Cần xem lại** | Image có tag nhưng không dùng (phải pull hoặc build lại) và container đã dừng (mất nhật ký của chúng). |
| **Có thể chứa dữ liệu** | Volume không container nào dùng. Có thể chứa database nên chỉ được liệt kê, kèm dự án đã tạo ra nó. |

Dashboard không bao giờ tự xóa bất cứ thứ gì.

## 11. Import dự án, Up và Down

**Khởi động**, **Dừng**, **Khởi động lại** và **Nhật ký** dùng được cho mọi dự án mà không cần import. Bạn chỉ cần import để dùng:

- **Up:** tạo hoặc tạo lại container từ file Compose, ví dụ sau khi `Down` hoặc sau khi sửa file.
- **Down:** xóa container và network của dự án. Volume có tên được giữ lại.

Để import, mở **Chi tiết** và bấm **＋ Import dự án**. Nút này xuất hiện khi Docker biết chính xác một file Compose duy nhất của dự án. Nếu không có nút này, bấm **＋ Thêm thủ công** trên header và nhập:

- tên dự án;
- thư mục (đường dẫn tuyệt đối);
- tên file Compose, tương đối so với thư mục (ví dụ `docker-compose.yml`).

Up luôn hiện cửa sổ xem lại trước, và kiểm tra file Compose cùng port. Down luôn yêu cầu xác nhận.

## 12. Ngôn ngữ

Dùng nút **Tiếng Việt / English** trên header. Trang chuyển ngay và ghi nhớ lựa chọn, kể cả sau khi khởi động lại. Tên dự án, container, đường dẫn, port và nội dung nhật ký không bao giờ bị dịch.

## 13. Câu hỏi và sự cố thường gặp

| Vấn đề | Cách xử lý |
|---|---|
| *Không thể kết nối Docker Engine* | Mở Docker Desktop, chờ chạy xong rồi bấm **Làm mới**. |
| Thiếu một dự án | Chỉ tìm được dự án còn container. Bấm **Quét Docker**, hoặc **Thêm thủ công**. |
| Khởi động bị chặn | Đọc thông báo đỏ: nó nêu container đang giữ port hoặc network bị thiếu. |
| Badge `N nguồn` | Tên dự án được chạy từ các thư mục hoặc bộ file Compose khác nhau. Chi tiết liệt kê từng nguồn; Khởi động/Dừng tác động lên tất cả. |
| Port 4173 đã bị dùng | Chạy `DEV_MANAGER_PORT=4174 npm start`. |
| Không có số liệu CPU/RAM | Chạy `docker stats --no-stream` trong terminal để kiểm tra Docker. |
