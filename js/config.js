// === 系統共用設定檔 (config.js) ===

// ★ 請將下方引號內的網址替換為您剛剛在 Google Apps Script 部署取得的「網頁應用程式網址」
const API_URL = "https://script.google.com/macros/s/AKfycbzW-FXXIYAWWTaMyD5ppmt732aqzVqpsDCemhfLetHB3ja08zQZqhA2PD-zYLgEfjym/exec";

async function callGAS(action, dataObj = {}, retries = 3) {
  // 將動作與資料打包成 payload 傳送給後端
  const payload = { action: action, payload: dataObj };
  
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      // ★ 設定為 text/plain 避免 GAS 產生 CORS (跨來源請求) 阻擋問題
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload) 
    });

    if (!response.ok) {
      // 遇到 502 或 503 塞車時，啟動「無感自動重試」
      if ((response.status === 503 || response.status === 502) && retries > 0) {
        console.warn(`[${action}] 遭遇 ${response.status} 塞車，準備自動重試... (剩餘次數: ${retries})`);
        
        if (Swal.isVisible()) {
          Swal.update({ title: '線路稍忙，系統自動重試中...' });
        }

        // 暫停 2 秒讓伺服器喘息
        await new Promise(resolve => setTimeout(resolve, 2000));

        // 呼叫自己進行重試
        return await callGAS(action, dataObj, retries - 1);
      }
      
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return await response.json();

  } catch (error) {
    console.error(`[${action}] API 請求錯誤:`, error);
    
    if (error.name === 'TypeError' && error.message.includes('Failed to fetch')) {
      Swal.fire({
        icon: 'error',
        title: '網路連線異常',
        html: `系統無法連接至雲端伺服器。<br>請確認網路連線是否正常。`,
        confirmButtonColor: '#2C5343'
      });
    } else {
      Swal.fire('系統錯誤', '伺服器持續忙碌，請稍後再試。', 'error');
    }
    return { success: false, message: '連線或伺服器異常' };
  }
}

// ==========================================
// 全局共用的 Toast 提示工具
// ==========================================
const Toast = Swal.mixin({
  toast: true,
  position: 'top-end',
  showConfirmButton: false,
  timer: 2000,
  timerProgressBar: true,
  didOpen: (toast) => {
    toast.addEventListener('mouseenter', Swal.stopTimer)
    toast.addEventListener('mouseleave', Swal.resumeTimer)
  }
});
