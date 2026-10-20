import { esc } from './ui-utils.js';
const $=selector=>document.querySelector(selector);
// background: polling that must not count as user activity for the session timeout.
export async function accountApi(path,data,method='POST',background=false){
  const headers={...(method==='GET'?{}:{'Content-Type':'application/json'}),...(background?{'X-Eticket-Background':'1'}:{})};
  const response=await fetch('/api/'+path,{method,credentials:'same-origin',headers,...(method==='GET'?{}:{body:JSON.stringify(data||{})})});
  let result;try{result=await response.json()}catch{throw new Error('No se pudo conectar con el servidor. Inicia el proyecto con npm start.')}
  if(!response.ok)throw Object.assign(new Error(result.error||'No se pudo completar la operación.'),{status:response.status,data:result});return result;
}
// Without SMTP, npm start prints the code in its terminal (server/accounts.js, devMail).
const devHint=result=>result?.codeInConsole?' Sin SMTP: el código aparece en la terminal donde corre npm start.':'';
export function renderAuth(mode,{app,back,go,toast,useAccount,completeAuth}){
  if(!['login','registro','verificacion','recuperar','restablecer'].includes(mode)){go('login');return;}
  const verify=mode==='verificacion',reset=mode==='restablecer',forgot=mode==='recuperar';
  const titles={login:'Qué bueno verte',registro:'Crea tu cuenta',verificacion:'Verifica tu correo',recuperar:'Recupera tu contraseña',restablecer:'Elige una nueva contraseña'};
  const savedEmail=sessionStorage.getItem('eticket-auth-email')||'';
  // The address is always visible, so the code can be typed in a new tab or on another device.
  app.innerHTML=`${back('cartelera')}<section class="panel form-card"><div class="eyebrow">Tu cuenta eTicket</div><h1>${titles[mode]}</h1><p>${verify?'Introduce el código de 6 dígitos que enviamos a tu correo. Vence en 10 minutos.':reset?'Introduce el código recibido y tu nueva contraseña.':forgot?'Te enviaremos un código de recuperación a tu correo.':'Accede con tu cuenta o regístrate con tu correo electrónico.'}</p><form id="auth">
  ${mode==='registro'?'<div class="field"><label>Nombres</label><input name="firstNames" autocomplete="given-name" maxlength="40" required></div><div class="field"><label>Apellido paterno</label><input name="paternalSurname" maxlength="19" required></div><div class="field"><label>Apellido materno</label><input name="maternalSurname" maxlength="19" required></div>':''}
  <div class="field"><label>Correo electrónico</label><input name="email" type="email" maxlength="254" autocomplete="email" value="${esc(savedEmail)}" required></div>
  ${verify||reset?'<div class="field"><label>Código de verificación</label><input name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" required></div>':''}
  ${['login','registro','restablecer'].includes(mode)?`<div class="field"><label>${reset?'Nueva contraseña':'Contraseña'}</label><input name="password" type="password" minlength="6" maxlength="15" ${mode==='login'?'':'pattern="(?=.*[A-ZÁÉÍÓÚÜÑ])(?=.*[^\\p{L}\\p{N}\\s]).{6,15}"'} autocomplete="${mode==='login'?'current-password':'new-password'}" required><small class="muted">6 a 15 caracteres, una mayúscula y un símbolo.</small></div>`:''}
  ${mode==='registro'||reset?`<div class="field"><label>Confirmar ${reset?'nueva ':''}contraseña</label><input name="confirmPassword" type="password" minlength="6" maxlength="15" autocomplete="new-password" required></div>`:''}
  <p id="auth-error" class="error" role="alert"></p><button class="btn" id="auth-submit" style="width:100%">${{login:'Iniciar sesión',registro:'Crear cuenta',verificacion:'Verificar cuenta',recuperar:'Enviar código',restablecer:'Guardar contraseña'}[mode]}</button></form>
  <div id="auth-help"></div>${verify?'<button class="btn secondary" id="resend" type="button" style="margin-top:12px">Reenviar código</button>':''}<div class="actions">${mode==='login'?'<a href="#registro">Crear cuenta</a><a href="#recuperar">Olvidé mi contraseña</a>':'<a href="#login">Volver al inicio de sesión</a>'}</div></section>`;
  const emailNow=()=>($('#auth [name="email"]')?.value||'').trim().toLowerCase();
  $('#auth').onsubmit=async ev=>{ev.preventDefault();const form=ev.target,data=Object.fromEntries(new FormData(form)),button=$('#auth-submit'),error=$('#auth-error');button.disabled=true;error.textContent='';$('#auth-help').innerHTML='';if(data.email){data.email=data.email.trim().toLowerCase();sessionStorage.setItem('eticket-auth-email',data.email)}
    try{
      if((mode==='registro'||reset)&&data.password!==data.confirmPassword)throw new Error('Las contraseñas no coinciden.');
      if(mode==='registro'){const result=await accountApi('auth/register',data);go('verificacion');toast('Enviamos un código a tu correo.'+devHint(result));return;}
      if(verify){const result=await accountApi('auth/verify',data);sessionStorage.removeItem('eticket-auth-email');await useAccount(result.user);toast('Cuenta verificada.');completeAuth();return;}
      if(forgot){const result=await accountApi('auth/forgot',data);go('restablecer');toast('Si la cuenta existe, enviamos un código.'+devHint(result));return;}
      if(reset){await accountApi('auth/reset',data);sessionStorage.removeItem('eticket-auth-email');toast('Contraseña actualizada. Inicia sesión.');go('login');return;}
      const result=await accountApi('auth/login',data);await useAccount(result.user);toast('Sesión iniciada.');completeAuth();
    }catch(e){
      error.textContent=e.message;
      // An account that was never verified gets its code again from here.
      if(mode==='login'&&e.data?.unverified){
        $('#auth-help').innerHTML='<button class="btn secondary" id="verify-now" type="button" style="width:100%;margin-top:8px">Enviarme un código nuevo para verificar</button>';
        $('#verify-now').onclick=async()=>{try{const result=await accountApi('auth/resend',{email:data.email});go('verificacion');toast('Te enviamos un código nuevo.'+devHint(result))}catch(err){error.textContent=err.message}};
      }
    }finally{button.disabled=false}
  };
  $('#resend')?.addEventListener('click',async()=>{const email=emailNow();if(!email){$('#auth-error').textContent='Escribe tu correo para reenviar el código.';return}try{const result=await accountApi('auth/resend',{email});sessionStorage.setItem('eticket-auth-email',email);toast('Si la cuenta existe y falta verificarla, enviamos un código nuevo.'+devHint(result))}catch(e){$('#auth-error').textContent=e.message}});
}
