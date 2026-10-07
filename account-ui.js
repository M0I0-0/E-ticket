const $=selector=>document.querySelector(selector);
export async function accountApi(path,data,method='POST'){
  const response=await fetch('/api/'+path,{method,credentials:'same-origin',...(method==='GET'?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(data||{})})});
  let result;try{result=await response.json()}catch{throw new Error('No se pudo conectar con el servidor. Inicia el proyecto con npm start.')}
  if(!response.ok)throw new Error(result.error||'No se pudo completar la operación.');return result;
}
export function renderAuth(mode,{app,back,go,toast,useAccount,completeAuth}){
  if(!['login','registro','verificacion','recuperar','restablecer'].includes(mode)){go('login');return;}
  const verify=mode==='verificacion',reset=mode==='restablecer',forgot=mode==='recuperar';
  const titles={login:'Qué bueno verte',registro:'Crea tu cuenta',verificacion:'Verifica tu correo',recuperar:'Recupera tu contraseña',restablecer:'Elige una nueva contraseña'};
  const savedEmail=sessionStorage.getItem('eticket-auth-email')||'';
  app.innerHTML=`${back('cartelera')}<section class="panel form-card"><div class="eyebrow">Tu cuenta eTicket</div><h1>${titles[mode]}</h1><p>${verify?'Introduce el código de 6 dígitos que enviamos a tu correo. Vence en 10 minutos.':reset?'Introduce el código recibido y tu nueva contraseña.':forgot?'Te enviaremos un código de recuperación a tu correo.':'Accede con tu cuenta o regístrate con tu correo electrónico.'}</p><form id="auth">
  ${mode==='registro'?'<div class="field"><label>Nombres</label><input name="firstNames" autocomplete="given-name" maxlength="40" required></div><div class="field"><label>Apellido paterno</label><input name="paternalSurname" maxlength="19" required></div><div class="field"><label>Apellido materno</label><input name="maternalSurname" maxlength="19" required></div>':''}
  ${!verify&&!reset?`<div class="field"><label>Correo electrónico</label><input name="email" type="email" maxlength="254" autocomplete="email" value="${savedEmail}" required></div>`:`<input name="email" type="hidden" value="${savedEmail}"><div class="field"><label>Código de verificación</label><input name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required></div>`}
  ${['login','registro','restablecer'].includes(mode)?`<div class="field"><label>${reset?'Nueva contraseña':'Contraseña'}</label><input name="password" type="password" minlength="6" maxlength="15" ${mode==='login'?'':'pattern="(?=.*[A-ZÁÉÍÓÚÜÑ])(?=.*[^\\p{L}\\p{N}\\s]).{6,15}"'} autocomplete="${mode==='login'?'current-password':'new-password'}" required><small class="muted">6 a 15 caracteres, una mayúscula y un símbolo.</small></div>`:''}
  ${mode==='registro'?'<div class="field"><label>Confirmar contraseña</label><input name="confirmPassword" type="password" minlength="6" maxlength="15" required></div>':''}
  <p id="auth-error" class="error" role="alert"></p><button class="btn" style="width:100%">${{login:'Iniciar sesión',registro:'Crear cuenta',verificacion:'Verificar cuenta',recuperar:'Enviar código',restablecer:'Guardar contraseña'}[mode]}</button></form>
  ${verify?'<button class="btn secondary" id="resend" style="margin-top:12px">Reenviar código</button>':''}<div class="actions">${mode==='login'?'<a href="#registro">Crear cuenta</a><a href="#recuperar">Olvidé mi contraseña</a>':'<a href="#login">Volver al inicio de sesión</a>'}</div></section>`;
  $('#auth').onsubmit=async ev=>{ev.preventDefault();const form=ev.target,data=Object.fromEntries(new FormData(form)),button=form.querySelector('button'),error=$('#auth-error');button.disabled=true;error.textContent='';if(data.email){data.email=data.email.trim().toLowerCase();sessionStorage.setItem('eticket-auth-email',data.email)}
    try{
      if(mode==='registro'){if(data.password!==data.confirmPassword)throw new Error('Las contraseñas no coinciden.');await accountApi('auth/register',data);go('verificacion');toast('Enviamos un código a tu correo.');return;}
      if(verify){const result=await accountApi('auth/verify',data);sessionStorage.removeItem('eticket-auth-email');await useAccount(result.user);toast('Cuenta verificada.');completeAuth();return;}
      if(forgot){await accountApi('auth/forgot',data);go('restablecer');toast('Si la cuenta existe, enviamos un código.');return;}
      if(reset){await accountApi('auth/reset',data);sessionStorage.removeItem('eticket-auth-email');toast('Contraseña actualizada. Inicia sesión.');go('login');return;}
      const result=await accountApi('auth/login',data);await useAccount(result.user);toast('Sesión iniciada.');completeAuth();
    }catch(e){error.textContent=e.message}finally{button.disabled=false}
  };
  $('#resend')?.addEventListener('click',async()=>{try{await accountApi('auth/resend',{email:savedEmail});toast('Código reenviado.')}catch(e){$('#auth-error').textContent=e.message}});
}
