export function mountGameSwitch(client, document = globalThis.document, confirm = globalThis.confirm) {
  const $ = id => document.getElementById(id);
  const names = { alag: 'Алаг мэлхий', horse: 'Морь уралдуулах' };
  $('switch-game').onclick = () => {
    if (!client.canSwitch()) return;
    const settings = client.switchSettings();
    $('switch-target').value = settings.gameType === 'alag' ? 'horse' : 'alag';
    for (const option of $('switch-target').options) option.disabled = option.value === settings.gameType;
    $('switch-length').value = String(settings.trackLength);
    $('switch-length').disabled = $('switch-target').value !== 'horse';
    $('switch-dialog').showModal();
  };
  $('switch-target').onchange = () => { $('switch-length').disabled = $('switch-target').value !== 'horse'; };
  $('switch-cancel').onclick = () => $('switch-dialog').close();
  $('switch-confirm').onclick = () => {
    if (!client.canSwitch()) { $('switch-dialog').close(); return; }
    const from = client.switchSettings().gameType, target = $('switch-target').value;
    if (!confirm(`${names[from]} тоглоомыг дуусгаад ${names[target]} тоглоомыг шинээр эхлүүлэх үү?`)) return;
    if (client.requestSwitch(target, Number($('switch-length').value))) $('switch-dialog').close();
  };
}
