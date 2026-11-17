/**
 * Nội dung trang hướng dẫn (nút ? ở góc trên). {{ORIGIN}} = địa chỉ trang này, {{HOST}} = tên máy hoặc IP của server.
 * Khối "code" có nút sao chép.
 */
window.HELP_PAGES = {
  overview: `
    <h3>Platform gồm những gì</h3>
    <ul>
      <li><b>Máy chủ</b> (một máy luôn bật trong mạng nội bộ): giữ rule, bug cũ, tài khoản test, mật khẩu mã hóa, tác vụ tự động.</li>
      <li><b>QA Launcher</b> (chạy trên máy của từng người): mở Chrome của chính bạn và tự đăng nhập bằng Playwright. Mật khẩu không đi qua trang web.</li>
      <li><b>Trang web này</b> ({{ORIGIN}}): xem rule, phân tích bug, mở tài khoản, chạy tác vụ.</li>
    </ul>
    <h3>Mỗi người cần</h3>
    <ul>
      <li>Token cá nhân do quản trị viên cấp (dán ở màn hình đăng nhập).</li>
      <li>Node.js bản 22 và Google Chrome (hoặc Microsoft Edge).</li>
      <li>QA Launcher đang chạy khi muốn bấm mở tài khoản hoặc chạy tác vụ.</li>
    </ul>
    <h3>Các tab</h3>
    <ul>
      <li><b>Tài Khoản và Môi Trường</b>: bấm tài khoản để mở và đăng nhập; chọn link muốn vào; đặt mật khẩu (cần quyền).</li>
      <li><b>Phân Tích Bug</b>: gõ mô tả, hệ thống tự tìm rule và bug cũ liên quan (tìm theo từ khóa, không phải mô hình ngôn ngữ).</li>
      <li><b>Tra Cứu Bug</b>: tra cứu hơn 6.000 bug cũ và bug mới lấy realtime từ Haraworks (kèm trạng thái, người xử lý), lọc theo module, trạng thái, người thực hiện, người duyệt, thời gian; mở chi tiết để xem bình luận, ảnh, video ngay trên trang.</li>
      <li><b>Kho Business Rule</b>: xem, tìm, thêm, sửa, xóa rule (cần quyền để sửa). Rule có nhãn "Chưa xác nhận" là rule AI vừa khám phá, chưa có người kiểm.</li>
      <li><b>Tác Vụ Tự Động</b>: chạy tác vụ Playwright (dùng được ngay, không cần duyệt), chỉ trên Staging.</li>
      <li><b>Phân Quyền</b>: chỉ quản trị viên thấy; thêm người dùng, đổi quyền, cấp token.</li>
    </ul>
    <h3>Vai trò và quyền</h3>
    <p>Quản trị viên có mọi quyền. Thành viên chỉ làm được các việc được cấp: sửa môi trường, đặt mật khẩu, đẩy rule, thêm/sửa/xóa rule, đẩy tác vụ lên.</p>`,

  'server-win': `
    <p class="help-note">Làm một lần khi cài. Sau đó mỗi lần chạy xem tab <b>Chạy hằng ngày</b>.</p>
    <h3>A. Cài lần đầu (admin, PowerShell)</h3>
    <ol>
      <li>Cài Node.js 22 từ nodejs.org, mở PowerShell mới: <code>node -v</code> phải ra v22.</li>
      <li>Trong thư mục project: <pre class="help-code">npm i</pre></li>
      <li>Tạo tài khoản quản trị: <pre class="help-code">node scripts/team-user.mjs add "Tên quản trị" admin</pre> Token in ra một lần, lưu lại.</li>
      <li>Xem IP của máy chủ: <pre class="help-code">Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" } | Select-Object IPAddress, InterfaceAlias</pre></li>
      <li>Cấp chứng chỉ HTTPS cho đúng IP đó (cần mkcert, cài bằng <code>winget install FiloSottile.mkcert</code>): <pre class="help-code">mkcert -cert-file secrets\\tls.crt -key-file secrets\\tls.key localhost 127.0.0.1 IP_MAY_CHU</pre></li>
      <li>Lấy file gửi cho thành viên: <pre class="help-code">mkcert -CAROOT</pre> Mở thư mục in ra, gửi file <code>rootCA.pem</code>.</li>
      <li>Mở cổng 3001 (PowerShell chạy bằng quyền Administrator): <pre class="help-code">New-NetFirewallRule -DisplayName "QA Platform 3001" -Direction Inbound -Protocol TCP -LocalPort 3001 -Action Allow -Profile Private,Domain</pre></li>
      <li>Tạo token cho từng thành viên: <pre class="help-code">node scripts/team-user.mjs add "Tên thành viên" member</pre></li>
      <li>Nếu admin cũng Explore module, lưu cấu hình đẩy: <pre class="help-code">node scripts/qa-sync.mjs --save-config https://IP_MAY_CHU:3001 TOKEN_CUA_ADMIN</pre></li>
    </ol>
    <p>Khi IP máy chủ đổi, làm lại bước 4 đến 6. Gửi lại <code>rootCA.pem</code> nếu CA thay đổi.</p>
    <h3>B. Các lần sau</h3>
    <p>Không cần làm lại các bước trên. Xem tab <b>Chạy hằng ngày</b>.</p>`,

  'member-win': `
    <p class="help-note">Làm một lần khi cài. Cần: thư mục project, file <code>rootCA.pem</code>, token riêng.</p>
    <h3>A. Cài lần đầu (PowerShell)</h3>
    <ol>
      <li>Cài Node.js 22 và Google Chrome. Kiểm tra: <pre class="help-code">node -v</pre> phải ra v22.</li>
      <li>Trong thư mục project: <pre class="help-code">npm i</pre></li>
      <li>Tin chứng chỉ máy chủ (PowerShell chạy bằng quyền Administrator): <pre class="help-code">certutil -addstore -f Root "C:\\Users\\TEN_BAN\\Downloads\\rootCA.pem"</pre> Sau đó đóng hết và mở lại Chrome.</li>
      <li>Nếu bạn Explore module, lưu cấu hình đẩy một lần: <pre class="help-code">node scripts/qa-sync.mjs --save-config https://IP_MAY_CHU:3001 TOKEN_CUA_BAN</pre></li>
    </ol>
    <h3>B. Các lần sau</h3>
    <p>Xem tab <b>Chạy hằng ngày</b>. Máy Mac xem tab <b>Thành viên (macOS)</b>.</p>`,

  'member-mac': `
    <p>Làm một lần trên máy Mac của thành viên (Terminal, zsh). Bạn cần: thư mục project, file <code>rootCA.pem</code> và token riêng từ quản trị viên.</p>
    <h3>1. Cài Node.js 22 và Chrome</h3>
    <p>Cách dễ nhất: tải file <code>.pkg</code> bản 22 tại nodejs.org. Hoặc dùng Homebrew:</p>
    <pre class="help-code">brew install node@22</pre>
    <p>Cài Google Chrome vào thư mục Applications (launcher dùng Chrome hoặc Edge, không dùng Safari). Kiểm tra:</p>
    <pre class="help-code">node -v</pre>
    <p>Nếu dùng Homebrew mà vẫn không nhận lệnh, thêm vào PATH rồi mở Terminal mới (Mac Intel đổi <code>/opt/homebrew</code> thành <code>/usr/local</code>):</p>
    <pre class="help-code">echo 'export PATH="/opt/homebrew/opt/node@22/bin:$PATH"' >> ~/.zshrc</pre>
    <h3>2. Cài thư viện</h3>
    <p>Giải nén project, mở Terminal trong thư mục đó:</p>
    <pre class="help-code">npm i</pre>
    <h3>3. Tin chứng chỉ của server</h3>
    <p>Lưu <code>rootCA.pem</code> vào thư mục home (<code>~/rootCA.pem</code>) rồi chạy (hỏi mật khẩu máy Mac):</p>
    <pre class="help-code">sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain ~/rootCA.pem</pre>
    <p>Đóng và mở lại Chrome.</p>
    <h3>4. Chạy launcher (giữ cửa sổ Terminal mở khi làm việc)</h3>
    <pre class="help-code">node apps/launcher/launcher.js --server {{ORIGIN}}</pre>
    <p>Launcher tự tìm <code>~/rootCA.pem</code>. Nếu để file nơi khác, thêm <code>--ca "/duong/dan/rootCA.pem"</code> vào cuối lệnh.</p>
    <h3>5. Mở trang</h3>
    <p>Mở <b>{{ORIGIN}}</b> bằng <b>Chrome</b> (Safari có thể chặn trang HTTPS gọi sang launcher), dán token, rồi bấm tài khoản. Nếu Chrome hỏi quyền truy cập thiết bị trong mạng cục bộ, chọn Cho phép.</p>
    <p>Hồ sơ đăng nhập lưu ở <code>~/.qa-launcher/profiles</code> trên máy bạn. Lần sau chỉ cần chạy lại lệnh ở bước 4.</p>`,

  admin: `
    <h3>Quản lý người dùng</h3>
    <p>Vào tab <b>6. Phân Quyền</b>: thêm người dùng, đổi vai trò và quyền lẻ, cấp token mới, thu hồi. Có hiệu lực ngay, không cần khởi động lại server. Không thể thu hồi chính mình hoặc quản trị viên cuối cùng.</p>
    <h3>Quyền lẻ của thành viên</h3>
    <ul>
      <li><b>Sửa môi trường</b>: thêm, sửa, xóa môi trường.</li>
      <li><b>Đặt/xóa mật khẩu</b>: lưu mật khẩu tài khoản test (chỉ Staging và Production OrgID DEMO).</li>
      <li><b>Đẩy rule và bug</b>: dùng lệnh đồng bộ từ Kho Business Rule.</li>
      <li><b>Thêm, sửa, xóa rule</b>: chỉnh rule ngay trên tab 4.</li>
      <li><b>Đẩy tác vụ nháp</b>: đưa tác vụ tự động lên ở trạng thái Nháp, không duyệt được.</li>
      <li><b>Duyệt tác vụ</b>: đọc code rồi duyệt tác vụ tự động; cũng gỡ được tác vụ.</li>
    </ul>
    <h3>Đưa rule, bug và tác vụ từ Kho lên platform</h3>
    <p>Sau khi Claude xuất dữ liệu từ Kho Business Rule vào <code>database/kb-snapshot/</code>, chạy trên máy có token (chỉ cần quyền "Đẩy rule và bug" và "Đẩy tác vụ nháp", không cần admin):</p>
    <pre class="help-code">$env:QA_SERVER_URL="{{ORIGIN}}"; $env:QA_TOKEN="token_cua_ban"; node scripts/qa-sync.mjs</pre>
    <p>Rule chờ xác nhận lên platform kèm nhãn "Chưa xác nhận". Rule thêm hoặc sửa trực tiếp trên platform nằm ở lớp riêng, đồng bộ từ Kho không ghi đè và cũng không tự ghi ngược về Kho.</p>
    <h3>Cấp lại token</h3>
    <p>Mất token hoặc token bị lộ: vào tab 6, bấm "Cấp token mới" ở dòng người đó. Token cũ mất hiệu lực ngay.</p>`,

  'daily': `
    <p class="help-note">Dùng cho mọi lần sau khi đã cài xong. Admin và thành viên đều xem.</p>
    <h3>Admin (máy chạy server)</h3>
    <ol>
      <li>Mở PowerShell trong thư mục project, khởi động server cho nhóm: <pre class="help-code">.\\start-team.ps1</pre> Cửa sổ này phải mở suốt thời gian nhóm làm việc.</li>
      <li>Muốn bật AI phân tích bug, đặt khóa trước khi chạy (cùng cửa sổ): <pre class="help-code">$env:GEMINI_API_KEY = "khoa-cua-ban"</pre></li>
      <li>Đẩy rule và tác vụ mới sau khi Explore: <pre class="help-code">node scripts/qa-sync.mjs --no-bugs</pre></li>
    </ol>
    <h3>Thành viên (máy của bạn)</h3>
    <ol>
      <li>Mở PowerShell trong thư mục project, chạy launcher và để cửa sổ này mở khi làm việc: <pre class="help-code">node apps/launcher/launcher.js --server https://IP_MAY_CHU:3001</pre></li>
      <li>Mở trình duyệt vào <code>https://IP_MAY_CHU:3001</code> và đăng nhập bằng token.</li>
    </ol>
    <h3>Khi IP máy chủ đổi</h3>
    <p>Admin làm lại mục A.4 đến A.6 ở tab <b>Cài máy chủ (Windows)</b>. Mỗi thành viên chạy lại launcher với địa chỉ mới, và chạy lại lệnh <code>--save-config</code> nếu có cấu hình đẩy.</p>`,

  'rulebug': `
    <p class="help-note">Lệnh chạy trong Windows PowerShell, trong thư mục project. Đẩy lên server nhóm cần token riêng có quyền tương ứng. Bản đầy đủ: <code>docs/operations/them-rule-va-bug.md</code>.</p>
    <h3>Thêm rule</h3>
    <ol>
      <li><b>Một rule:</b> tab Kho Business Rule, bấm <b>+ Thêm rule</b> (cần quyền thêm, sửa, xóa rule). Rule này chỉ nằm trên platform.</li>
      <li><b>Nhiều rule (nên dùng):</b> chạy skill <code>business-rule-extractor</code> (lệnh <code>Explore</code>). Skill tự đẩy lên sau mỗi lần Explore. Cài một lần trên máy chạy skill:
        <pre class="help-code">node scripts/qa-sync.mjs --save-config https://IP_MAY_CHU:3001 TOKEN_CUA_BAN</pre>
        Đẩy tay khi cần:
        <pre class="help-code">node scripts/qa-sync.mjs --no-bugs</pre>
        Rule lên kèm nhãn "Chưa xác nhận" cho đến khi được xác nhận trong Kho. Tác vụ tự động sinh ra cũng lên cùng lúc, dùng được ngay.</li>
      <li><b>Không đẩy được tự động:</b> trên máy chạy server bấm <b>⟳ Cập nhật rule từ kho</b>. Ở máy khác, tạo file rồi bấm <b>Nhập file kho</b>:
        <pre class="help-code">node scripts/sync-business-rules.mjs --export kho-rule.json</pre></li>
    </ol>
    <h3>Thêm bug</h3>
    <ol>
      <li><b>Bug realtime từ Haraworks (admin làm một lần trên máy chạy server):</b> đăng nhập tasks.haraworks.vn, mở DevTools (F12), tab Network, bấm một yêu cầu tới tasks.haraworks.vn, sao chép giá trị header <code>cookie</code>. Tạo file <code>secrets\\haraworks.json</code>:
        <pre class="help-code">{ "cookie": "dán nguyên giá trị header cookie vào đây" }</pre>
        Khởi động lại server (<code>.\\start-team.ps1</code>). Thanh trạng thái ở Tra Cứu Bug sẽ báo <b>Realtime</b>. Cookie hết hạn thì thanh báo "Chưa realtime", di chuột vào để xem lý do, rồi lấy cookie mới. Cookie chỉ nằm trên server, không đưa lên GitHub.</li>
      <li><b>Bug cũ:</b> Claude xuất <code>data/bugs.json</code> từ Kho vào <code>database/kb-snapshot/data/bugs.json</code>, rồi:
        <pre class="help-code">node scripts/sync-bugs.mjs</pre>
        (cần token quyền rules, đã lưu bằng <code>--save-config</code>).</li>
    </ol>
    <h3>Kiểm tra</h3>
    <ul>
      <li>Rule: tab Kho Business Rule, tìm theo mã hoặc từ khóa.</li>
      <li>Bug: tab Tra Cứu Bug, số bug ở đầu trang, lọc theo module, trạng thái, người duyệt, thời gian. Mở một bug để xem mô tả, lịch sử, bình luận, ảnh và video ngay trên trang.</li>
      <li>Phân Tích Bug dùng cả rule và bug này; bug có nhãn <b>Bug mới</b> (30 ngày gần đây) hoặc <b>Bug cũ</b>.</li>
    </ul>`,

  errors: `
    <table class="qa-table"><thead><tr><th>Triệu chứng</th><th>Cách xử lý</th></tr></thead><tbody>
      <tr><td>Trình duyệt báo chứng chỉ không an toàn</td><td>Chưa tin <code>rootCA.pem</code>. Làm lại bước "Tin chứng chỉ" trong hướng dẫn thành viên, rồi mở lại Chrome. Địa chỉ phải đúng tên hoặc IP đã ghi khi tạo chứng chỉ.</td></tr>
      <tr><td>Token bị báo sai</td><td>Token chép từ terminal hay bị lặp ký tự ở chỗ xuống dòng. Độ dài đúng là <code>qa_</code> cộng 32 ký tự. Nhờ quản trị cấp token mới nếu vẫn sai.</td></tr>
      <tr><td>Bấm tài khoản báo chưa chạy QA Launcher</td><td>Launcher chưa chạy, hoặc địa chỉ <code>--server</code> khác địa chỉ trên thanh địa chỉ (phải giống từng ký tự, kể cả https).</td></tr>
      <tr><td>Launcher báo không tin chứng chỉ HTTPS</td><td>Thêm <code>--ca "đường-dẫn/rootCA.pem"</code> vào lệnh chạy launcher.</td></tr>
      <tr><td>Launcher báo cổng 3002 đang được dùng</td><td>Đã có một launcher đang chạy rồi, không cần chạy thêm.</td></tr>
      <tr><td>Không vào được trang</td><td>Máy phải cùng mạng hoặc VPN với server, server đang chạy, tường lửa mở cổng 3001. Thử mở <code>{{ORIGIN}}/api/v1/health</code>, phải thấy HEALTHY.</td></tr>
      <tr><td>Script đẩy dữ liệu báo lỗi chứng chỉ</td><td>Thêm <code>--ca "đường-dẫn/rootCA.pem"</code> vào cuối lệnh, hoặc đặt biến <code>NODE_EXTRA_CA_CERTS</code> trỏ tới file đó.</td></tr>
      <tr><td>Tác vụ tự động hết thời gian chờ</td><td>Xem dòng lỗi của bước thất bại (có dòng "waiting for locator" cho biết đang chờ phần tử nào) rồi báo lại cho người soạn tác vụ.</td></tr>
      <tr><td>Production không chạy tự động được</td><td>Hệ thống Production đã chặn bot. Chỉ mở cửa sổ và tự đăng nhập, thao tác thủ công.</td></tr>
    </tbody></table>`
};
