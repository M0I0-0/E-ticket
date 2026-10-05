const $ = selector => document.querySelector(selector);
export async function accountApi(path, data, method = 'POST') {
  const response = await fetch('/api/' + path, {
    method, credentials: 'same-origin',
    ...(method === 'GET' ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data || {}) }),
  });
  let result;
  try { result = await response.json(); }
  catch { throw new Error('No se pudo conectar con el servidor. Inicia el proyecto con npm start.'); }
  if (!response.ok) throw new Error(result.error || 'No se pudo completar la operación.');
  return result;
}
export function renderAuth(mode, { app, back, go, toast, useAccount, completeAuth, onReset }) {
  if (!['login','registro'].includes(mode)) { sessionStorage.removeItem('eticket-verification'); go('login'); return; }
  const verify = false, reset = false;
  const titles = { login:'Qué bueno verte', registro:'Crea tu cuenta', verificacion:'Verifica tu correo', recuperar:'Recupera tu contraseña', restablecer:'Elige una nueva contraseña' };
  app.innerHTML = `${back('cartelera')}<section class="panel form-card"><div class="eyebrow">Tu cuenta eTicket</div><h1>${titles[mode]}</h1>
    <p>${verify || reset ? 'Introduce el código de 6 dígitos recibido por correo. Vence en 10 minutos.' : mode === 'recuperar' ? 'Enviaremos un código al correo de tu cuenta para restablecer el acceso.' : 'Accede con tu cuenta o regístrate con tu correo electrónico.'}</p>
    <form id="auth">
    ${mode === 'registro' ? '<div class="field"><label for="firstNames">Nombres</label><input id="firstNames" name="firstNames" autocomplete="given-name" maxlength="40" required></div><div class="field"><label for="paternalSurname">Apellido paterno</label><input id="paternalSurname" name="paternalSurname" autocomplete="section-paternal family-name" maxlength="19" required></div><div class="field"><label for="maternalSurname">Apellido materno</label><input id="maternalSurname" name="maternalSurname" autocomplete="section-maternal family-name" maxlength="19" required></div>' : ''}
    ${!verify && !reset ? '<div class="field"><label for="email">Correo electrónico *</label><input id="email" name="email" type="email" placeholder="tu@correo.com" autocomplete="email" maxlength="254" required></div>' : '<div class="field"><label for="code">Código de verificación</label><input id="code" name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" required></div>'}
    ${['login','registro','restablecer'].includes(mode) ? `<div class="field"><label for="password">${reset ? 'Nueva contraseña' : 'Contraseña'}</label><input id="password" name="password" type="password" autocomplete="${mode==='login'?'current-password':'new-password'}" minlength="6" maxlength="15" ${mode === 'login' ? '' : 'pattern="(?=.*[A-ZÁÉÍÓÚÜÑ])(?=.*[^\\p{L}\\p{N}\\s]).{6,15}"'} required><small class="muted">Entre 6 y 15 caracteres, con una mayúscula y un carácter especial (por ejemplo, !, @ o #).</small></div>` : ''}
    ${mode === 'registro' ? '<div class="field"><label for="confirmPassword">Confirmar contraseña</label><input id="confirmPassword" name="confirmPassword" type="password" autocomplete="new-password" minlength="6" maxlength="15" required></div>' : ''}
    <p id="auth-error" class="error" role="alert"></p><button class="btn" type="submit" style="width:100%">${{login:'Iniciar sesión',registro:'Crear cuenta',verificacion:'Verificar cuenta',recuperar:'Enviar código',restablecer:'Guardar contraseña'}[mode]}</button>
    </form>
    ${verify || reset ? '<button class="btn secondary" id="resend-code" type="button">Reenviar código</button>' : ''}
    <div class="actions">${mode==='login'?'<a href="#registro">Crear cuenta</a>':'<a href="#login">Volver al inicio de sesión</a>'}</div></section>`;
  const error = $('#auth-error');
  if (mode === 'registro') {
    const confirm = $('#confirmPassword');
    const validate = () => confirm.setCustomValidity(confirm.value && confirm.value !== $('#password').value ? 'Las contraseñas no coinciden.' : '');
    confirm.oninput = validate;
    $('#password').oninput = validate;
  }
  $('#auth').onsubmit = async e => {
    e.preventDefault();
    const form=e.target, data=Object.fromEntries(new FormData(form)), button=form.querySelector('button[type="submit"]');
    button.disabled=true;error.textContent='';
    if(data.email) data.email=data.email.trim();
    try {
      if(mode === 'registro' && data.password !== data.confirmPassword) throw new Error('Las contraseñas no coinciden.');
      const result=await accountApi('auth/'+(mode==='registro'?'register':'login'),data);
      sessionStorage.removeItem('eticket-verification');
      await useAccount(result.user);
      toast(mode === 'registro' ? 'Cuenta creada. Bienvenido a eTicket.' : 'Sesión iniciada.');
      completeAuth();
    } catch(err) {error.textContent=err.message;}
    finally {button.disabled=false;}
  };
}
