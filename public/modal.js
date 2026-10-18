// Modal dialogs in Monitor's style, instead of the browser's confirm() and alert().
// Built on <dialog>, which keeps keyboard focus inside and closes on Esc.
//
//   if (await Modal.confirm({ title: 'REMOVE CAMERA', text: 'Remove Camera 1?', ok: 'REMOVE', danger: true })) ...
//   await Modal.alert({ title: 'CANNOT REACH CAMERA', text: '...' });
//
// confirm() resolves true for OK, false for CANCEL, Esc or a click next to the box.

const Modal = (() => {
  function open({ title = '', text = '', ok = 'OK', cancel = 'CANCEL', danger = false, alert = false }) {
    return new Promise((resolve) => {
      const dlg = document.createElement('dialog');
      dlg.className = 'modal';
      dlg.innerHTML = `
        <form method="dialog">
          <h2 class="modal-title"></h2>
          <p class="modal-text"></p>
          <div class="modal-actions">
            ${alert ? '' : '<button class="btn" value="cancel"></button>'}
            <button class="btn primary" value="ok"></button>
          </div>
        </form>`;
      dlg.querySelector('.modal-title').textContent = title;
      dlg.querySelector('.modal-text').textContent = text;
      const okBtn = dlg.querySelector('[value="ok"]');
      const cancelBtn = dlg.querySelector('[value="cancel"]');
      okBtn.textContent = ok;
      if (danger) okBtn.classList.add('danger-solid');
      if (cancelBtn) cancelBtn.textContent = cancel;

      dlg.addEventListener('click', (e) => e.target === dlg && dlg.close('cancel')); // the backdrop
      dlg.addEventListener('close', () => {
        resolve(dlg.returnValue === 'ok');
        dlg.remove();
      });
      document.body.append(dlg);
      dlg.showModal();
      // Enter shouldn't do something destructive by accident: focus CANCEL then.
      (danger && cancelBtn ? cancelBtn : okBtn).focus();
    });
  }

  return {
    confirm: (opts) => open(opts),
    alert: (opts) => open({ ...opts, alert: true }).then(() => undefined),
  };
})();
