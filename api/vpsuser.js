<script>
        const createBtn = document.getElementById('createBtn');
        const tokenInput = document.getElementById('token');
        const resultDiv = document.getElementById('result');

        createBtn.addEventListener('click', async () => {
            // ✅ Lấy token và loại bỏ khoảng trắng
            let token = tokenInput.value.trim();
            
            if (!token) {
                showResult('error', '❌ Vui lòng nhập GitHub Token!');
                return;
            }
            
            // ✅ Kiểm tra token có đúng định dạng cơ bản không (chỉ cảnh báo, không chặn)
            if (!token.startsWith('github_pat_') && !token.startsWith('ghp_') && !token.startsWith('gho_')) {
                showResult('error', '⚠️ Token có vẻ không đúng định dạng. Vui lòng kiểm tra lại!<br><small>Token GitHub thường bắt đầu bằng "github_pat_" hoặc "ghp_"</small>');
                return;
            }
            
            createBtn.disabled = true;
            createBtn.innerHTML = '<span class="loading"></span> Đang tạo VPS...';
            
            try {
                const response = await fetch('/api/vpsuser', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ githubToken: token })  // ✅ Gửi token đã trim
                });
                
                const data = await response.json();
                
                if (data.success) {
                    showResult('success', `
                        ✅ ${data.message}<br><br>
                        📦 <strong>Repo:</strong> <a href="${data.repoUrl}" target="_blank">${data.repoUrl}</a><br>
                        ⚙️ <strong>Actions:</strong> <a href="${data.actionsUrl}" target="_blank">Xem trạng thái VPS</a><br><br>
                        💡 VPS sẽ tự động chạy sau vài phút!
                    `);
                } else {
                    showResult('error', `❌ Lỗi: ${data.error}`);
                }
            } catch (error) {
                showResult('error', `❌ Lỗi kết nối: ${error.message}`);
            } finally {
                createBtn.disabled = false;
                createBtn.innerHTML = '✨ Tạo VPS Ngay';
            }
        });

        function showResult(type, message) {
            resultDiv.className = `result ${type}`;
            resultDiv.innerHTML = message;
        }
    </script>
