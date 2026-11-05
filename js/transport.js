// js/transport.js
let globalDocConfigs = [];
const scannedItems = new Set(); // ★ 將 scannedItems 提升為全域變數

// ==========================================
// 音效模組
// ==========================================
function playSuccessSound() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  const ctx = new AudioContext();
  const osc = ctx.createOscillator();
  const gainNode = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(800, ctx.currentTime); 
  gainNode.gain.setValueAtTime(0.1, ctx.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
  osc.connect(gainNode);
  gainNode.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.15);
}

function playErrorSound() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  const ctx = new AudioContext();
  const osc = ctx.createOscillator();
  const gainNode = ctx.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(150, ctx.currentTime); 
  osc.frequency.linearRampToValueAtTime(100, ctx.currentTime + 0.3);
  gainNode.gain.setValueAtTime(0.2, ctx.currentTime);
  gainNode.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.3);
  osc.connect(gainNode);
  gainNode.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.3);
}

// ==========================================
// 主邏輯控制塊 
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
  // 1. 權限檢查
  const transId = sessionStorage.getItem('transId');
  const transName = sessionStorage.getItem('transName');

  if (!transId || !transName) {
    Swal.fire('未授權', '請先登入', 'warning').then(() => {
      window.location.href = 'transport_login.html'; 
    });
    return;
  }
  document.getElementById('displayUser').textContent = `${transName} (${transId})`;

  // 2. 設定今日日期
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const medDateInput = document.getElementById('medDate');
  if(medDateInput) medDateInput.value = today;

  // 3. 初始化文件選單與清單
  if(document.getElementById('docTypeSelect')) {
    await loadDocConfig();
    loadTodayDocs();
  }

  // 4. 出院帶藥條碼輸入邏輯
  const barcodeInput = document.getElementById('barcodeInput');
  const totalCountSpan = document.getElementById('totalCount');
  
  // ★ 新增：LocalStorage 記憶功能 (傳送端)
  const localKey = `medLog_transport_${transId}`;
  let localData = JSON.parse(localStorage.getItem(localKey) || '{"date":"","items":[]}');

  if (localData.date !== today) {
    localData = { date: today, items: [] };
    localStorage.setItem(localKey, JSON.stringify(localData));
  } else {
    localData.items.forEach(item => {
      if (item.isCancelDispense) {
          scannedItems.delete(`${item.data.dispenseNo}-${item.data.rxDate}`);
      } else {
          scannedItems.add(`${item.data.dispenseNo}-${item.data.rxDate}`);
      }
      addCardToUI(item.data, item.cardId, true, item.isDuplicateLabel, item.isCancelDispense);
    });
    if(totalCountSpan) totalCountSpan.textContent = scannedItems.size;
  }
  
  if(barcodeInput) {
    barcodeInput.focus();
    document.body.addEventListener('click', (e) => {
      const activeTab = document.querySelector('.nav-link.active');
      if (activeTab && activeTab.id === 'discharge-tab') {
        const tagName = e.target.tagName;
        if (tagName !== 'BUTTON' && !e.target.classList.contains('nav-link') && tagName !== 'INPUT' && tagName !== 'SELECT' && tagName !== 'OPTION') {
           if(barcodeInput) barcodeInput.focus();
        }
      }
    });

    barcodeInput.addEventListener('keypress', async (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const barcodeValue = barcodeInput.value.trim();
        if (!barcodeValue) return;

        // ★ 核心功能：如果目前在「昨日」模式，刷入條碼瞬間強制切回「今日」
        const dateSelect = document.getElementById('medDateSelect');
        if (dateSelect && dateSelect.value === 'yesterday') {
          dateSelect.value = 'today';
          dateSelect.dispatchEvent(new Event('change'));
        }

        const parts = barcodeValue.split(';');
        if (parts.length < 5 || !parts[2] || !parts[2].startsWith('8')) {
          playErrorSound(); 
          Swal.fire({ icon: 'error', title: '條碼格式錯誤', text: '請確認是否刷對條碼，領藥號必須為 8 開頭！', timer: 2000 });
          barcodeInput.value = '';
          return;
        }

        const chartNo = parts[0]; 
        const dispenseNo = parts[2]; 
        const rawDateStr = parts[4]; 
        const dateMatch = rawDateStr.match(/[A-Za-z](\d{8})/);
        const rxDate = dateMatch ? dateMatch[1] : '';

        const itemKey = `${dispenseNo}-${rxDate}`;
        const isNewItem = !scannedItems.has(itemKey);
        const cardId = 'card_' + Date.now();

        let finalTaskType = '傳送'; 
        let isDuplicateLabel = false;
        let isCancelDispense = false;

        if (isNewItem) {
          scannedItems.add(itemKey);
        } else {
          playErrorSound(); 
          const { value: userChoice } = await Swal.fire({
            title: '⚠️ 重複刷入提示',
            text: `領藥號 ${dispenseNo} 剛剛已經刷入過了！請問您要：`,
            icon: 'warning',
            showDenyButton: true,
            showCancelButton: true,
            confirmButtonText: '覆蓋重刷 (維持傳送)',
            denyButtonText: '取消領藥',
            cancelButtonText: '取消動作 (不記錄)',
            confirmButtonColor: '#198754', 
            denyButtonColor: '#dc3545',    
            allowOutsideClick: false
          });

          if (userChoice === true) {
            finalTaskType = '傳送';
            isDuplicateLabel = true;
          } else if (userChoice === false) {
            finalTaskType = '取消領藥';
            isDuplicateLabel = true;
            isCancelDispense = true;
            scannedItems.delete(itemKey); // 從 Set 中移除
          } else {
            barcodeInput.value = '';
            barcodeInput.focus();
            return; 
          }
        }

        // ★ 加入 staffId 以利卡片渲染
        const dataForCard = { chartNo, dispenseNo, rxDate, staffName: transName, staffId: transId, type: finalTaskType };
        
        const now = new Date();
        dataForCard.timeString = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}`;
        
        if (isNewItem) {
          addCardToUI(dataForCard, cardId, true); 
        } else {
          addCardToUI(dataForCard, cardId, true, isDuplicateLabel, isCancelDispense); 
        }
        
        // ★ 核心修復：不論是新增還是取消，統一在最後一行將「計算後的剩餘筆數」更新至畫面
        if(totalCountSpan) totalCountSpan.textContent = scannedItems.size;

        localData.items.push({
          data: dataForCard,
          cardId: cardId,
          isDuplicateLabel: isDuplicateLabel,
          isCancelDispense: isCancelDispense
        });
        localStorage.setItem(localKey, JSON.stringify(localData));
        
        barcodeInput.value = '';
        barcodeInput.focus();

        const result = await callGAS('logDischargeMeds', {
          date: document.getElementById('medDate').value,
          barcode: barcodeValue,
          type: finalTaskType, 
          staffId: transId,
          staffName: transName,
          chartNo: chartNo,
          dispenseNo: dispenseNo,
          rxDate: rxDate
        });
        
        if (result.success) {
          playSuccessSound(); 
          const successCard = document.getElementById(cardId);
          if(successCard) successCard.classList.replace('border-warning', 'border-success');
        } else {
          playErrorSound();
          const errorCard = document.getElementById(cardId);
          if(errorCard){
            errorCard.classList.replace('border-warning', 'border-danger');
            errorCard.querySelector('.card-body').innerHTML += `<div class="text-danger mt-1 fs-6 fw-bold">寫入失敗</div>`;
          }
        }
      }
    });
  }

  // 5. 監聽文件類型下拉選單 (動態長出欄位)
  const docTypeSelect = document.getElementById('docTypeSelect');
  const container = document.getElementById('dynamicFieldsContainer');
  if (docTypeSelect && container) {
    docTypeSelect.addEventListener('change', (e) => {
      const selectedType = e.target.value;
      container.innerHTML = '';
      if (!selectedType) {
        container.innerHTML = '<div class="text-muted text-center py-4 fs-5">請先選擇送件類型</div>';
        return;
      }
      const config = globalDocConfigs.find(c => (c['送件類型名稱'] || c.Title) === selectedType);
      if (!config) return;

      let html = '';
      const excludeKeys = ['Title', '送件類型名稱'];
      Object.keys(config).forEach(key => {
        if (!excludeKeys.includes(key)) {
          const requirement = config[key]; 
          if (requirement !== '隱藏') {
            const isRequired = requirement === '必填' ? 'required' : '';
            const star = requirement === '必填' ? '<span class="text-danger">*</span>' : '<span class="text-muted fs-6">(選填)</span>';
            
            let customPlaceholder = `請輸入${key}...`;
            if (key === '病房床號') {
              customPlaceholder = '例如: 08A011';
            } else if (key === '數量/張數') {
              customPlaceholder = '例如: 1 或 2';
            } else if (key === '領藥號') {
              customPlaceholder = '例如: 70001 或 80001';
            } else if (key === '病歷號') {
              customPlaceholder = '例如: A12345';
            }

            html += `
              <div class="mb-3 text-start">
                <label class="form-label fw-bold fs-5">${key} ${star}</label>
                <input type="text" class="form-control form-control-lg dynamic-input" data-key="${key}" placeholder="${customPlaceholder}" ${isRequired}>
              </div>
            `;
          }
        }
      });
      if (html === '') html = '<div class="text-success text-center py-3 fw-bold"><i class="bi bi-check-circle me-2"></i>此文件不需填寫額外資料，請直接送出</div>';
      container.innerHTML = html;
    });
  }

  // 6. 攔截表單送出
  const docForm = document.getElementById('docForm');
  if (docForm) {
    docForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const wardInput = document.querySelector('input[data-key="病房床號"]');
      const chartInput = document.querySelector('input[data-key="病歷號"]');
      const qtyInput = document.querySelector('input[data-key="數量/張數"]');
      const pickupInput = document.querySelector('input[data-key="領藥號"]');

      const payload = {
        type: document.getElementById('docTypeSelect').value,
        ward: wardInput ? wardInput.value.trim() : '',
        chartNo: chartInput ? chartInput.value.trim() : '',
        quantity: qtyInput ? qtyInput.value.trim() : '',
        pickupNo: pickupInput ? pickupInput.value.trim() : '',
        sendNote: document.getElementById('docNote').value.trim(),
        senderId: sessionStorage.getItem('transId'),
        senderName: sessionStorage.getItem('transName')
      };

      const btn = document.getElementById('btnSubmitDoc');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>傳送中...';

      const res = await callGAS('submitDocTransfer', payload);

      if (res.success) {
        Swal.fire({ icon: 'success', title: '送件成功', text: `系統單號: ${res.signId}`, timer: 1500, showConfirmButton: false });
        docForm.reset();
        document.getElementById('dynamicFieldsContainer').innerHTML = '<div class="text-muted text-center py-4 fs-5">請先選擇送件類型</div>';
        
        setTimeout(() => {
          loadTodayDocs(); 
        }, 1500);
      } else {
        Swal.fire('失敗', res.message, 'error');
      }
      btn.disabled = false;
      btn.innerHTML = '<i class="bi bi-send-fill me-2"></i>確認送出';
    });
  }

  const btnRefreshDoc = document.getElementById('btnRefreshDoc');
  if (btnRefreshDoc) btnRefreshDoc.addEventListener('click', loadTodayDocs);
  const docTab = document.getElementById('doc-tab');
  if (docTab) docTab.addEventListener('shown.bs.tab', loadTodayDocs);
});

// ==========================================
// 各項獨立輔助函數
// ==========================================
function addCardToUI(data, cardId, isPending, isDuplicate = false, isCancel = false) {
  const container = document.getElementById('cardContainer');
  const emptyState = document.getElementById('emptyState');
  if (emptyState) emptyState.style.display = 'none';
  
  const card = document.createElement('div');
  card.id = cardId;
  card.className = `card mb-3 shadow-sm ${isPending ? 'border-warning' : 'border-success'} border-2`;
  
  const now = new Date();
  const timeString = data.timeString || `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}`;

  card.innerHTML = `
    <div class="card-body py-3 px-4">
      <div class="d-flex justify-content-between align-items-center mb-2">
        <h3 class="m-0 ${isCancel ? 'text-danger' : 'text-success'} fw-bold">領藥號：${data.dispenseNo} 
          ${isDuplicate && !isCancel ? '<span class="badge bg-warning text-dark fs-6 ms-2">重複刷入</span>' : ''}
          ${isCancel ? '<span class="badge bg-danger text-white fs-6 ms-2">取消領藥</span>' : ''}
        </h3>
        <span class="text-muted fs-4">${timeString}</span>
      </div>
      <div class="mb-2 fs-5 text-secondary">病歷號：<span class="fw-bold text-dark">${data.chartNo}</span> | 處方日期：${data.rxDate}</div>
      <div class="fs-5 text-secondary border-top pt-2">
        <span class="badge ${isCancel ? 'bg-danger' : 'bg-success'} me-2 fs-6">
          <i class="bi ${isCancel ? 'bi-x-circle' : 'bi-person-walking'} me-1"></i>${data.type}
        </span>
        <!-- ★ 卡片底部增加顯示 staffId -->
        由 <span class="fw-bold text-success">${data.staffName} (${data.staffId}) 傳送</span> 處理
      </div>
    </div>`;
  container.insertBefore(card, container.firstChild);
}

async function loadDocConfig() {
  const select = document.getElementById('docTypeSelect');
  if(!select) return;
  select.innerHTML = '<option value="">資料載入中...</option>';
  try {
    const response = await callGAS('getConfigData'); 
    if (response.success && response.data) {
      globalDocConfigs = response.data; 
      select.innerHTML = '<option value="">請選擇類型...</option>';
      response.data.forEach(item => {
          const opt = document.createElement('option');
          const val = item['送件類型名稱'] || item.Title;
          opt.value = val;
          opt.textContent = val;
          select.appendChild(opt);
      });
    } else {
      select.innerHTML = '<option value="">無法取得選單</option>';
    }
  } catch (err) {
    select.innerHTML = '<option value="">連線失敗</option>';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const allTabs = document.querySelectorAll('button[data-bs-toggle="tab"], button[data-bs-toggle="pill"]');
  allTabs.forEach(tab => {
    tab.addEventListener('shown.bs.tab', (e) => {
      if (['doc-tab', 'doc-unresolved-tab', 'doc-resolved-tab'].includes(e.target.id)) {
        loadTodayDocs();
      }
    });
  });
});

async function loadTodayDocs() {
  const unresolvedContainer = document.getElementById('docUnresolved');
  const resolvedContainer = document.getElementById('docResolved');
  const btn = document.getElementById('btnRefreshDoc');
  if (!unresolvedContainer || !resolvedContainer) return;

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>讀取中';
  }
  
  const loadingHtml = '<div class="text-muted text-center py-5 fs-5">資料讀取中...</div>';
  unresolvedContainer.innerHTML = loadingHtml;
  resolvedContainer.innerHTML = loadingHtml;

  const res = await callGAS('getTodayDocRecords');

  if (res.success) {
    const limitTimestamp = new Date().getTime() - (48 * 60 * 60 * 1000);
    const todayStr = new Date().toLocaleDateString('zh-TW');

    let unresolvedData = [];
    let resolvedData = [];

    res.data.forEach(item => {
      const itemTime = new Date(item.sendTime || item.SendTime || 0);
      const isClosed = item.isClosed || item.IsClosed || (item.status && (item.status.includes('已結案') || item.status.includes('已領回')));
      
      if (!isClosed && itemTime.getTime() >= limitTimestamp) {
        unresolvedData.push(item);
      } else if (isClosed && itemTime.toLocaleDateString('zh-TW') === todayStr) {
        resolvedData.push(item);
      }
    });

    const sortDesc = (a, b) => new Date(b.sendTime || b.SendTime || 0) - new Date(a.sendTime || a.SendTime || 0);
    unresolvedData.sort(sortDesc);
    resolvedData.sort(sortDesc);

// 卡片渲染函數 (傳送端與藥師端統一外觀)
    const renderCards = (dataArray, emptyMsg) => {
      if (dataArray.length === 0) return `<div class="text-muted text-center py-5 fs-5">${emptyMsg}</div>`;
      
      return dataArray.map(item => {
        let details = [];
        const wardVal = item.ward || item.Ward;
        const chartVal = item.chartNo || item.ChartNo;
        const qtyVal = item.quantity || item.Quantity;
        const pickupVal = item.pickupNo || item.PickupNo;
        const status = item.status || item.Status;
        const type = item.type || item.Type || item.DocType;
        const signId = item.signId || item.SignId;
        const sendNote = item.sendNote || item.SendNote;
        const receiveNote = item.receiveNote || item.ReceiveNote;
        const sender = item.sender || item.SenderName || '';
        const senderId = item.senderId || item.SenderId || '';
        const pharma = item.pharmaName || item.PharmaName || '等待中';
        const sendTime = item.sendTime || item.SendTime || '';
        const receiveTime = item.receiveTime || item.ReceiveTime || '';

        if (wardVal) details.push(`病房: <span class="fw-bold text-primary fs-5 align-middle">${wardVal}</span>`);
        if (chartVal) details.push(`病歷: <span class="fw-bold text-dark fs-5 align-middle">${chartVal}</span>`);
        if (qtyVal) details.push(`數量: <span class="text-danger fw-bold fs-5 align-middle">${qtyVal}</span>`);
        if (pickupVal) details.push(`領藥號: <span class="text-success fw-bold fs-5 align-middle">${pickupVal}</span>`);

        let statusBadge = 'bg-warning text-dark';
        let borderColor = 'border-warning';
        if (status === '退件') { statusBadge = 'bg-danger text-white'; borderColor = 'border-danger'; }
        else if (status.includes('已結案') || status.includes('已領回') || status === '收下不歸還') { statusBadge = 'bg-secondary text-white'; borderColor = 'border-secondary'; }
        else if (status !== '待藥師收單') { statusBadge = 'bg-primary text-white'; borderColor = 'border-primary'; }

        const senderStr = senderId ? `${sender} (${senderId})` : sender;
        const receiveTimeStr = receiveTime ? `(${receiveTime.substring(11,16)})` : '';
        const sendTimeStr = sendTime ? sendTime.substring(0, 16) : '';

        const args = `'${signId}', '${type}', '${wardVal || ''}', '${chartVal || ''}', '${qtyVal || ''}', '${pickupVal || ''}', '${sendNote || ''}'`;

        let actionsHtml = '';
        if (status === '掛牌待傳送領回' || status === '退件') {
           actionsHtml += `<button class="btn btn-sm btn-success fw-bold me-1" onclick="acknowledgeReturn('${signId}')">確認領回</button>`;
        }
        if (status === '待藥師收單') {
           actionsHtml += `<button class="btn btn-sm btn-outline-primary fw-bold" onclick="editSenderDoc(${args})"><i class="bi bi-pencil-square me-1"></i>修改資料</button>`;
        }

        return `
        <div class="card mb-3 shadow-sm border-start border-4 ${borderColor}">
          <div class="card-body p-3">
            <div class="d-flex justify-content-between align-items-center mb-2">
              <div>
                <span class="badge ${statusBadge} fs-6 me-2">${status}</span>
                <strong class="fs-4 text-dark align-middle">${type}</strong>
              </div>
              <span class="text-muted small"><i class="bi bi-clock me-1"></i>${sendTimeStr}</span>
            </div>
            
            <div class="text-secondary mb-2 mt-2 lh-base border-bottom pb-2">
              ${details.join('<span class="mx-2 text-black-50 fw-light">|</span>')}
            </div>
            
            ${sendNote ? `<div class="text-danger small mb-2 bg-light p-1 rounded border"><i class="bi bi-chat-left-text me-1"></i>送件備註: ${sendNote}</div>` : ''}
            ${receiveNote ? `<div class="text-primary small mb-2 bg-blue-light p-1 rounded border" style="background-color: #e7f1ff;"><i class="bi bi-capsule me-1"></i>藥師回覆: ${receiveNote}</div>` : ''}
            
            <div class="d-flex justify-content-between align-items-end mt-2 pt-1">
              <div class="small text-muted">
                <div class="mb-1"><i class="bi bi-person-walking"></i> 送件: <span class="fw-bold text-dark">${senderStr}</span></div>
                <div><i class="bi bi-capsule"></i> 藥師: <span class="${pharma === '等待中' ? 'text-danger' : 'text-primary'} fw-bold">${pharma} ${receiveTimeStr}</span></div>
              </div>
              <div>
                ${actionsHtml}
              </div>
            </div>
          </div>
        </div>`;
      }).join(''); 
    };

    unresolvedContainer.innerHTML = renderCards(unresolvedData, '近兩日無未結案紀錄');
    resolvedContainer.innerHTML = renderCards(resolvedData, '今日尚無已結案紀錄');

  } else {
    unresolvedContainer.innerHTML = '<div class="text-danger text-center py-5 fs-5">連線失敗</div>';
    resolvedContainer.innerHTML = '<div class="text-danger text-center py-5 fs-5">連線失敗</div>';
  }

  if (btn) {
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-arrow-clockwise me-1"></i>重整';
  }
}

async function editSenderDoc(signId, currentType, currentWard, currentChartNo, currentQty, currentPickup, currentSendNote) {
  const safeWard = (!currentWard || currentWard === 'undefined' || currentWard === 'null') ? '' : currentWard;
  const safeChartNo = (!currentChartNo || currentChartNo === 'undefined' || currentChartNo === 'null') ? '' : currentChartNo;
  const safeQty = (!currentQty || currentQty === 'undefined' || currentQty === 'null') ? '' : currentQty;
  const safePickup = (!currentPickup || currentPickup === 'undefined' || currentPickup === 'null') ? '' : currentPickup;
  const safeSendNote = (!currentSendNote || currentSendNote === 'undefined' || currentSendNote === 'null') ? '' : currentSendNote;

  const typeOptions = globalDocConfigs.map(c => {
    const val = c['送件類型名稱'] || c.Title;
    return `<option value="${val}" ${val === currentType ? 'selected' : ''}>${val}</option>`;
  }).join('');

  const { value: formValues } = await Swal.fire({
    title: '修改送件資料',
    html: `
      <div class="text-start g-2 mb-3">
        <div class="mb-2"><label class="small fw-bold text-muted">文件類型</label><select id="swal-type" class="form-select">${typeOptions}</select></div>
        <div class="mb-2"><label class="small fw-bold text-muted">病房床號 (6碼英數)</label><input id="swal-ward" class="form-control" value="${safeWard}" placeholder="例如: 8A1234" maxlength="6"></div>
        <div class="mb-2"><label class="small fw-bold text-muted">病歷號</label><input id="swal-chart" class="form-control" value="${safeChartNo}"></div>
        <div class="row">
          <div class="col-6 mb-2"><label class="small fw-bold text-muted">數量/張數</label><input id="swal-qty" class="form-control" value="${safeQty}"></div>
          <div class="col-6 mb-2"><label class="small fw-bold text-muted">領藥號</label><input id="swal-pickup" class="form-control" value="${safePickup}"></div>
        </div>
        <div class="mb-2"><label class="small fw-bold text-muted">送件備註</label><input id="swal-note" class="form-control" value="${safeSendNote}"></div>
      </div>
    `,
    showCancelButton: true,
    confirmButtonText: '確認修改',
    preConfirm: () => {
      const wardVal = document.getElementById('swal-ward').value.trim();
      if (wardVal !== '' && !/^[A-Za-z0-9]{6}$/.test(wardVal)) {
        Swal.showValidationMessage('病房床號格式錯誤，必須是 6 位數的英文與數字組合');
        return false;
      }
      return {
        type: document.getElementById('swal-type').value,
        ward: wardVal,
        chartNo: document.getElementById('swal-chart').value.trim(),
        quantity: document.getElementById('swal-qty').value.trim(),
        pickupNo: document.getElementById('swal-pickup').value.trim(),
        sendNote: document.getElementById('swal-note').value.trim()
      }
    }
  });

  if (formValues) {
    const res = await callGAS('editSenderDoc', { signId: signId, ...formValues });
    if (res.success) {
      Swal.fire({ icon: 'success', title: '修改成功', timer: 1500, showConfirmButton: false });
      loadTodayDocs(); 
    }
  }
}

function logout() {
  sessionStorage.clear();
  window.location.href = 'index.html';
}

// === 傳送人員確認領回 (退件或掛牌待傳送領回) ===
async function acknowledgeReturn(signId) {
  const transId = sessionStorage.getItem('transId');
  const transName = sessionStorage.getItem('transName');

  const { isConfirmed } = await Swal.fire({
    title: '確認領回文件？',
    text: '領回後此單據將正式結案，不再顯示於目前的清單中。',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#198754',
    confirmButtonText: '<i class="bi bi-check2-circle me-1"></i>是的，確認領回',
    cancelButtonText: '取消'
  });

  if (isConfirmed) {
    Swal.fire({
      title: '處理結案中...',
      allowOutsideClick: false,
      didOpen: () => { Swal.showLoading(); }
    });

    const payload = {
      signId: signId,
      returnerId: transId,
      returnerName: transName
    };

    const res = await callGAS('acknowledgeReturn', payload);

    if (res.success) {
      Swal.fire({ icon: 'success', title: '已成功領回並結案', timer: 1500, showConfirmButton: false });
      setTimeout(() => {
        loadTodayDocs(); 
      }, 1500);
    } else {
      Swal.fire('發生錯誤', res.message || '領回失敗，請稍後再試', 'error');
    }
  }
}

// === 綁定今日/昨日清單切換 (傳送端) ===
document.getElementById('medDateSelect')?.addEventListener('change', async (e) => {
  const mode = e.target.value;
  const container = document.getElementById('cardContainer');
  const totalSpan = document.getElementById('totalCount');
  const input = document.getElementById('barcodeInput');
  
  if (mode === 'today') {
    input.disabled = false;
    input.placeholder = "請刷入藥袋條碼...";
    input.focus();
    
    container.innerHTML = '<div class="text-muted text-center mt-5 fs-4" id="emptyState" style="display:none;">目前尚無紀錄</div>';
    scannedItems.clear();
    const localKey = `medLog_transport_${sessionStorage.getItem('transId')}`;
    const localData = JSON.parse(localStorage.getItem(localKey) || '{"date":"","items":[]}');
    
    localData.items.forEach(item => {
      if (item.isCancelDispense) scannedItems.delete(`${item.data.dispenseNo}-${item.data.rxDate}`);
      else scannedItems.add(`${item.data.dispenseNo}-${item.data.rxDate}`);
      addCardToUI(item.data, item.cardId, true, item.isDuplicateLabel, item.isCancelDispense);
    });
    totalSpan.textContent = scannedItems.size;
    if (localData.items.length === 0) document.getElementById('emptyState').style.display = 'block';

  } else {
    input.placeholder = "昨日歷史 (直接刷條碼會切回今日)...";
    input.focus(); 
    container.innerHTML = '<div class="text-center mt-5"><div class="spinner-border text-success"></div><div class="mt-2 text-muted fs-5">讀取昨日資料中...</div></div>';
    
    const y = new Date(); y.setDate(y.getDate() - 1);
    const yStr = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
    
    const res = await callGAS('getDailyRecords', { startDate: yStr, endDate: yStr });
    if (res.success) {
      container.innerHTML = '';
      const myItems = res.data.filter(r => r.staffId == sessionStorage.getItem('transId')).reverse();
      
      const latestState = {}; 
      myItems.forEach(r => {
        latestState[`${r.dispNo}-${r.rxDate}`] = r.TaskType;
        // ★ 加入 staffId 給昨日歷史的 mockData
        const mockData = { dispenseNo: r.dispNo, rxDate: r.rxDate, chartNo: r.chartNo, type: r.TaskType, staffName: r.staffName, staffId: r.staffId, timeString: r.time };
        addCardToUI(mockData, 'y_'+Date.now()+Math.random(), true, false, r.TaskType === '取消領藥');
      });
      
      let validCount = 0;
      Object.values(latestState).forEach(type => { if (type !== '取消領藥') validCount++; });
      totalSpan.textContent = validCount;
      
      if (myItems.length === 0) container.innerHTML = '<div class="text-muted text-center mt-5 fs-4">昨日無紀錄</div>';
    } else {
      container.innerHTML = '<div class="text-danger text-center mt-5 fs-4">連線失敗</div>';
      totalSpan.textContent = "0";
    }
  }
});
