import { ReflectionPrompt, UiLanguage } from "@/lib/types";

export const UI_LANGUAGE_OPTIONS: Array<{ value: UiLanguage; label: string }> = [
  { value: "english", label: "English" },
  { value: "spanish", label: "Español" },
  { value: "mandarin", label: "中文（普通话）" }
];

const languageLabels: Record<UiLanguage, Record<UiLanguage, string>> = {
  english: {
    english: "English",
    spanish: "Spanish",
    mandarin: "Mandarin"
  },
  spanish: {
    english: "Inglés",
    spanish: "Español",
    mandarin: "Mandarín"
  },
  mandarin: {
    english: "英语",
    spanish: "西班牙语",
    mandarin: "普通话"
  }
};

type WelcomeCopy = {
  title: string;
  subtitle: string;
  subtitleSecondary: string;
  languageLabel: string;
  authTitle: string;
  authSubtitle: string;
  signInTab: string;
  createAccountTab: string;
  passwordLabel: string;
  confirmPasswordLabel: string;
  signInButton: string;
  createAccountButton: string;
  signingInLabel: string;
  creatingAccountLabel: string;
  sendingResetLabel: string;
  signedInAs: (email: string) => string;
  signOutButton: string;
  forgotPasswordButton: string;
  resetPasswordSuccess: string;
  aboutYou: string;
  aboutYouSubtitle: string;
  yourFirstName: string;
  yourLastName: string;
  caregiver55OrOlder: string;
  aboutSupportedPerson: string;
  aboutSupportedPersonSubtitle: string;
  theirFirstName: string;
  theirLastName: string;
  theirPreferredName: string;
  theirDateOfBirth: string;
  reachYou: string;
  emailAddress: string;
  phoneNumber: string;
  optional: string;
  selectPrompt: string;
  yesOption: string;
  noOption: string;
  consent: string;
  privacyNote: string;
  continueLabel: string;
  continueHint: string;
  startingLabel: string;
  errors: {
    password: string;
    confirmPassword: string;
    passwordMismatch: string;
    authFailed: string;
    confirmationRequired: string;
    caregiverFirstName: string;
    caregiverLastName: string;
    caregiver55OrOlder: string;
    careRecipientFirstName: string;
    careRecipientLastName: string;
    careRecipientDateOfBirth: string;
    email: string;
    consent: string;
    startFailed: string;
  };
  placeholders: {
    caregiverFirstName: string;
    caregiverLastName: string;
    careRecipientFirstName: string;
    careRecipientLastName: string;
    careRecipientPreferredName: string;
    email: string;
    caregiverPhone: string;
  };
};

type ResetPasswordCopy = {
  title: string;
  subtitle: string;
  checkingLink: string;
  passwordLabel: string;
  confirmPasswordLabel: string;
  saveButton: string;
  savingButton: string;
  successMessage: string;
  invalidLinkMessage: string;
  passwordMismatch: string;
  passwordRequired: string;
  confirmPasswordRequired: string;
  updateFailed: string;
  backToSignIn: string;
};

type ReflectionCopy = {
  title: string;
  subtitle: string;
  completionMessage: string;
  enterAtLeastOneResponse: string;
  backButton: string;
  continueButton: string;
  sectionCounter: (current: number, total: number) => string;
  skippedLabel: string;
  skipButton: string;
  saveResponseButton: string;
  completeButton: string;
  buildingSummaryLabel: string;
  textareaPlaceholder: string;
  allQuestionsAnswered: string;
  recordResponseTitle: string;
  spokenLanguageLabel: string;
  recordButton: string;
  stopRecordingButton: string;
  audioLimitNotice: string;
  audioNotSupported: string;
  noSpeechDetected: string;
  recordingTooShort: string;
  recordingTooLarge: string;
  unableToTranscribe: string;
  unableToStartRecording: string;
  unableToFinishRecording: string;
  unableToGenerateSummary: string;
  promptCounter: (current: number, total: number) => string;
  audioReady: (languageLabel: string, isEnglish: boolean) => string;
  audioTranscribing: (languageLabel: string, isEnglish: boolean) => string;
  audioAdded: (isEnglish: boolean) => string;
  audioLimitReached: (languageLabel: string, isEnglish: boolean) => string;
  recordingStatus: (current: string, max: string) => string;
};

type ReviewCopy = {
  title: string;
  subtitle: string;
  generatedAtLabel: string;
  backToQuestionsButton: string;
  regenerateHint: string;
  summaryTitleLabel: string;
  overviewLabel: string;
  sectionsLabel: string;
  sectionTitleLabel: string;
  sectionItemsLabel: string;
  sectionTitlePlaceholder: string;
  sectionItemsPlaceholder: string;
  removeSectionButton: string;
  saveButton: string;
  savingButton: string;
  saveFailed: string;
  confirmFailed: string;
};

type CompletionCopy = {
  emptyTitle: string;
  emptySubtitle: string;
  emptyMessage: string;
  title: string;
  subtitle: string;
  generatedAtLabel: string;
  backToQuestionsButton: string;
  regenerateHint: string;
  overviewLabel: string;
  downloadPdfButton: string;
  emailPdfTitle: string;
  emailPdfSubtitle: string;
  recipientEmailLabel: string;
  recipientEmailPlaceholder: string;
  sendPdfButton: string;
  sendingPdfButton: string;
  emailSent: (email: string) => string;
  emailSendFailed: string;
  feedbackLabel: string;
  feedbackPlaceholder: string;
  commentsLabel: string;
  saveFeedbackButton: string;
  feedbackSaved: string;
  feedbackSaveFailed: string;
};

type PromptTranslation = {
  sectionTitle: string;
  stepId: ReflectionPrompt["stepId"];
  stepTitle: string;
  stepSubtitle: string;
  stepCompletionMessage: string;
  promptLabel: string;
  question: string;
  examples: string[];
};

const welcomeCopy: Record<UiLanguage, WelcomeCopy> = {
  english: {
    title: "This will take a couple minutes.",
    subtitle: "You can skip anything.",
    subtitleSecondary: "We'll turn this into something you can share with other caregivers.",
    languageLabel: "Website language",
    authTitle: "Save your progress",
    authSubtitle:
      "Create an account so you can come back anytime and pick up where you left off.",
    signInTab: "Sign in",
    createAccountTab: "Create account",
    passwordLabel: "Password",
    confirmPasswordLabel: "Confirm password",
    signInButton: "Sign in",
    createAccountButton: "Create account",
    signingInLabel: "Signing in...",
    creatingAccountLabel: "Creating account...",
    sendingResetLabel: "Sending reset email...",
    signedInAs: (email) => `Signed in as ${email}`,
    signOutButton: "Sign out",
    forgotPasswordButton: "Forgot password?",
    resetPasswordSuccess:
      "If that email is in the system, a password reset link has been sent.",
    aboutYou: "About you",
    aboutYouSubtitle: "(so we can personalize this)",
    yourFirstName: "First name",
    yourLastName: "Last name",
    caregiver55OrOlder:
      "Are you 55 or older? (this helps us understand aging caregiver experiences for the project)",
    aboutSupportedPerson: "About the person you support",
    aboutSupportedPersonSubtitle: "(so others understand who they are supporting)",
    theirFirstName: "First name",
    theirLastName: "Last name",
    theirPreferredName: "What name do they like to be called?",
    theirDateOfBirth: "Date of birth",
    reachYou: "How we can reach you",
    emailAddress: "Email address",
    phoneNumber: "Phone number",
    optional: "optional",
    selectPrompt: "Select one",
    yesOption: "Yes",
    noOption: "No",
    consent:
      "I agree to use this information to create a summary that I can share with other caregivers.",
    privacyNote: "Your personal information stays private and will not be shared.",
    continueLabel: "Continue",
    continueHint: "Next: You'll start with a simple question about what helps their day go well.",
    startingLabel: "Starting...",
    errors: {
      password: "Enter a password.",
      confirmPassword: "Confirm your password.",
      passwordMismatch: "Passwords must match.",
      authFailed: "Unable to sign in right now.",
      confirmationRequired:
        "Your account was created, but automatic sign-in is unavailable right now. Try signing in.",
      caregiverFirstName: "Enter your first name to start.",
      caregiverLastName: "Enter your last name to start.",
      caregiver55OrOlder: "Select whether you are 55 or older.",
      careRecipientFirstName: "Enter the first name of the person you support.",
      careRecipientLastName: "Enter the last name of the person you support.",
      careRecipientDateOfBirth: "Enter a valid date of birth or leave it blank.",
      email: "Enter an email address so we can connect this session to you.",
      consent: "Consent is required before starting.",
      startFailed: "Unable to start the intake."
    },
    placeholders: {
      caregiverFirstName: "First name",
      caregiverLastName: "Last name",
      careRecipientFirstName: "First name",
      careRecipientLastName: "Last name",
      careRecipientPreferredName: "Preferred name or nickname",
      email: "caregiver@example.com",
      caregiverPhone: "(555) 555-5555"
    }
  },
  spanish: {
    title: "Esto tomará un par de minutos.",
    subtitle: "Puede omitir cualquier cosa.",
    subtitleSecondary: "Convertiremos esto en algo que pueda compartir con otros cuidadores.",
    languageLabel: "Idioma del sitio",
    authTitle: "Guarde su progreso",
    authSubtitle:
      "Cree una cuenta para poder volver en cualquier momento y continuar donde lo dejó.",
    signInTab: "Iniciar sesión",
    createAccountTab: "Crear cuenta",
    passwordLabel: "Contraseña",
    confirmPasswordLabel: "Confirmar contraseña",
    signInButton: "Iniciar sesión",
    createAccountButton: "Crear cuenta",
    signingInLabel: "Iniciando sesión...",
    creatingAccountLabel: "Creando cuenta...",
    sendingResetLabel: "Enviando correo de restablecimiento...",
    signedInAs: (email) => `Sesión iniciada como ${email}`,
    signOutButton: "Cerrar sesión",
    forgotPasswordButton: "¿Olvidó su contraseña?",
    resetPasswordSuccess:
      "Si ese correo existe en el sistema, se ha enviado un enlace para restablecer la contraseña.",
    aboutYou: "Sobre usted",
    aboutYouSubtitle: "(para que podamos personalizar esto)",
    yourFirstName: "Nombre",
    yourLastName: "Apellido",
    caregiver55OrOlder:
      "¿Tiene 55 años o más? (esto nos ayuda a entender las experiencias de cuidadores mayores en el proyecto)",
    aboutSupportedPerson: "Sobre la persona a quien cuida",
    aboutSupportedPersonSubtitle: "(para que otras personas entiendan a quién van a apoyar)",
    theirFirstName: "Nombre",
    theirLastName: "Apellido",
    theirPreferredName: "¿Cómo le gusta que le llamen?",
    theirDateOfBirth: "Fecha de nacimiento",
    reachYou: "Cómo podemos contactarle",
    emailAddress: "Correo electrónico",
    phoneNumber: "Número de teléfono",
    optional: "opcional",
    selectPrompt: "Seleccione una opción",
    yesOption: "Sí",
    noOption: "No",
    consent:
      "Acepto usar esta información para crear un resumen que pueda compartir con otros cuidadores.",
    privacyNote: "Su información personal se mantiene privada y no será compartida.",
    continueLabel: "Continuar",
    continueHint:
      "Siguiente: comenzará con una pregunta simple sobre qué ayuda a que su día vaya bien.",
    startingLabel: "Iniciando...",
    errors: {
      password: "Ingrese una contraseña.",
      confirmPassword: "Confirme su contraseña.",
      passwordMismatch: "Las contraseñas deben coincidir.",
      authFailed: "No fue posible iniciar sesión en este momento.",
      confirmationRequired:
        "La cuenta fue creada, pero no fue posible iniciar sesión automáticamente. Intente iniciar sesión.",
      caregiverFirstName: "Ingrese su nombre para comenzar.",
      caregiverLastName: "Ingrese su apellido para comenzar.",
      caregiver55OrOlder: "Indique si tiene 55 años o más.",
      careRecipientFirstName: "Ingrese el nombre de la persona a quien cuida.",
      careRecipientLastName: "Ingrese el apellido de la persona a quien cuida.",
      careRecipientDateOfBirth:
        "Ingrese una fecha de nacimiento válida o deje este campo en blanco.",
      email: "Ingrese un correo electrónico para vincular esta sesión con usted.",
      consent: "Se requiere su consentimiento antes de comenzar.",
      startFailed: "No fue posible iniciar el formulario."
    },
    placeholders: {
      caregiverFirstName: "Nombre",
      caregiverLastName: "Apellido",
      careRecipientFirstName: "Nombre",
      careRecipientLastName: "Apellido",
      careRecipientPreferredName: "Nombre preferido o apodo",
      email: "cuidador@ejemplo.com",
      caregiverPhone: "(555) 555-5555"
    }
  },
  mandarin: {
    title: "这只需要几分钟。",
    subtitle: "任何问题都可以跳过。",
    subtitleSecondary: "我们会把这些内容整理成可与其他照护者分享的摘要。",
    languageLabel: "网站语言",
    authTitle: "保存您的进度",
    authSubtitle: "创建账号后，您随时都可以回来，从上次停下的地方继续。",
    signInTab: "登录",
    createAccountTab: "创建账号",
    passwordLabel: "密码",
    confirmPasswordLabel: "确认密码",
    signInButton: "登录",
    createAccountButton: "创建账号",
    signingInLabel: "正在登录...",
    creatingAccountLabel: "正在创建账号...",
    sendingResetLabel: "正在发送重置邮件...",
    signedInAs: (email) => `当前登录邮箱：${email}`,
    signOutButton: "退出登录",
    forgotPasswordButton: "忘记密码？",
    resetPasswordSuccess: "如果该邮箱已注册，系统会发送一封重置密码邮件。",
    aboutYou: "关于您",
    aboutYouSubtitle: "（方便我们为您个性化调整）",
    yourFirstName: "名字",
    yourLastName: "姓氏",
    caregiver55OrOlder: "您是否年满 55 岁？（这有助于我们了解项目中年长照护者的经历）",
    aboutSupportedPerson: "关于您照护的人",
    aboutSupportedPersonSubtitle: "（让其他人知道他们正在支持谁）",
    theirFirstName: "名字",
    theirLastName: "姓氏",
    theirPreferredName: "他们喜欢别人怎么称呼？",
    theirDateOfBirth: "出生日期",
    reachYou: "联系方式",
    emailAddress: "电子邮箱",
    phoneNumber: "电话号码",
    optional: "可选",
    selectPrompt: "请选择",
    yesOption: "是",
    noOption: "否",
    consent: "我同意使用这些信息来创建可与其他照护者分享的摘要。",
    privacyNote: "您的个人信息会被保密，不会被分享。",
    continueLabel: "继续",
    continueHint: "下一步：您将先回答一个简单问题，说明什么能帮助他们一天过得更顺利。",
    startingLabel: "正在开始...",
    errors: {
      password: "请输入密码。",
      confirmPassword: "请确认密码。",
      passwordMismatch: "两次输入的密码必须一致。",
      authFailed: "暂时无法登录。",
      confirmationRequired: "账号已创建，但暂时无法自动登录。请直接尝试登录。",
      caregiverFirstName: "请输入您的名字后再开始。",
      caregiverLastName: "请输入您的姓氏后再开始。",
      caregiver55OrOlder: "请选择您是否年满 55 岁。",
      careRecipientFirstName: "请输入您所照护者的名字。",
      careRecipientLastName: "请输入您所照护者的姓氏。",
      careRecipientDateOfBirth: "请输入有效的出生日期，或留空。",
      email: "请输入电子邮箱，以便将本次会话与您关联。",
      consent: "开始前需要先同意相关说明。",
      startFailed: "无法开始填写。"
    },
    placeholders: {
      caregiverFirstName: "名字",
      caregiverLastName: "姓氏",
      careRecipientFirstName: "名字",
      careRecipientLastName: "姓氏",
      careRecipientPreferredName: "常用名或昵称",
      email: "caregiver@example.com",
      caregiverPhone: "(555) 555-5555"
    }
  }
};

const reflectionCopy: Record<UiLanguage, ReflectionCopy> = {
  english: {
    title: "What helps the day go well",
    subtitle: "Communication. Answer what you can — short examples help.",
    completionMessage: "You just created a communication guide for your loved one.",
    enterAtLeastOneResponse: "Add at least one communication detail before continuing.",
    backButton: "Back",
    continueButton: "Continue",
    sectionCounter: (current, total) => `Section ${current} of ${total}`,
    skippedLabel: "Skipped",
    skipButton: "Skip",
    saveResponseButton: "Save response",
    completeButton: "Complete",
    buildingSummaryLabel: "Building summary...",
    textareaPlaceholder: "Write the most important details another caregiver should know...",
    allQuestionsAnswered: "All questions answered.",
    recordResponseTitle: "Record a response",
    spokenLanguageLabel: "Spoken language",
    recordButton: "Record response",
    stopRecordingButton: "Stop recording",
    audioLimitNotice: "Keep each recording under 45 seconds.",
    audioNotSupported: "Audio recording is not supported here.",
    noSpeechDetected: "No speech was detected. You can try again or type your response.",
    recordingTooShort: "Recording was too short. Try again or type your response.",
    recordingTooLarge:
      "That recording is too long. Keep recordings under 45 seconds, or type the rest.",
    unableToTranscribe: "Unable to transcribe the audio.",
    unableToStartRecording: "Unable to start audio recording.",
    unableToFinishRecording: "Unable to finish recording.",
    unableToGenerateSummary: "Unable to generate the summary.",
    promptCounter: (current, total) => `Prompt ${current} of ${total}`,
    audioReady: (languageLabel, isEnglish = languageLabel === "English") =>
      isEnglish
        ? "Speech is transcribed before saving."
        : `${languageLabel} speech is translated into English before saving.`,
    audioTranscribing: (languageLabel, isEnglish) =>
      isEnglish
        ? "Speech will be added as editable text."
        : `Turning ${languageLabel} speech into editable English text.`,
    audioAdded: (isEnglish) =>
      isEnglish
        ? "Transcript added to the response field. You can edit it before saving."
        : "English translation added to the response field. You can edit it before saving.",
    audioLimitReached: (languageLabel, isEnglish) =>
      isEnglish
        ? "45-second limit reached. Transcribing now and retrying automatically if the transcription service is busy..."
        : `45-second limit reached. Translating ${languageLabel} speech into English now and retrying automatically if the transcription service is busy...`,
    recordingStatus: (current, max) => `Recording ${current} of ${max}.`
  },
  spanish: {
    title: "Lo que ayuda a que el día vaya bien",
    subtitle: "Comunicación. Responda lo que pueda; los ejemplos cortos ayudan.",
    completionMessage: "Acaba de crear una guía de comunicación para su ser querido.",
    enterAtLeastOneResponse: "Agregue al menos un detalle sobre comunicación antes de continuar.",
    backButton: "Atrás",
    continueButton: "Continuar",
    sectionCounter: (current, total) => `Sección ${current} de ${total}`,
    skippedLabel: "Omitido",
    skipButton: "Omitir",
    saveResponseButton: "Guardar respuesta",
    completeButton: "Completar",
    buildingSummaryLabel: "Creando resumen...",
    textareaPlaceholder: "Escriba los detalles más importantes que otra persona cuidadora debería saber...",
    allQuestionsAnswered: "Todas las preguntas están respondidas.",
    recordResponseTitle: "Grabar respuesta",
    spokenLanguageLabel: "Idioma hablado",
    recordButton: "Grabar respuesta",
    stopRecordingButton: "Detener grabación",
    audioLimitNotice: "Mantenga cada grabación por debajo de 45 segundos.",
    audioNotSupported: "La grabación de audio no está disponible aquí.",
    noSpeechDetected: "No se detectó voz. Puede intentarlo de nuevo o escribir su respuesta.",
    recordingTooShort: "La grabación fue demasiado corta. Inténtelo de nuevo o escriba su respuesta.",
    recordingTooLarge:
      "La grabación es demasiado larga. Mantenga cada grabación por debajo de 45 segundos o escriba el resto.",
    unableToTranscribe: "No fue posible transcribir el audio.",
    unableToStartRecording: "No fue posible iniciar la grabación de audio.",
    unableToFinishRecording: "No fue posible completar la grabación.",
    unableToGenerateSummary: "No fue posible generar el resumen.",
    promptCounter: (current, total) => `Pregunta ${current} de ${total}`,
    audioReady: (languageLabel, isEnglish = languageLabel === "Inglés") =>
      isEnglish
        ? "La voz se transcribe antes de guardar."
        : `La voz en ${languageLabel} se traduce al inglés antes de guardar.`,
    audioTranscribing: (languageLabel, isEnglish) =>
      isEnglish
        ? "La voz se agregará como texto editable."
        : `Convirtiendo la voz en ${languageLabel} en texto editable en inglés.`,
    audioAdded: (isEnglish) =>
      isEnglish
        ? "La transcripción se agregó al campo de respuesta. Puede editarla antes de guardarla."
        : "La traducción al inglés se agregó al campo de respuesta. Puede editarla antes de guardarla.",
    audioLimitReached: (languageLabel, isEnglish) =>
      isEnglish
        ? "Se alcanzó el límite de 45 segundos. Se transcribirá ahora y se volverá a intentar automáticamente si el servicio de transcripción está ocupado..."
        : `Se alcanzó el límite de 45 segundos. La voz en ${languageLabel} se traducirá al inglés ahora y se volverá a intentar automáticamente si el servicio de transcripción está ocupado...`,
    recordingStatus: (current, max) => `Grabando ${current} de ${max}.`
  },
  mandarin: {
    title: "什么有助于让一天顺利进行",
    subtitle: "沟通。能回答多少就回答多少，简短例子会有帮助。",
    completionMessage: "您刚刚为您的亲人创建了一份沟通指南。",
    enterAtLeastOneResponse: "请至少补充一条与沟通有关的信息后再继续。",
    backButton: "返回",
    continueButton: "继续",
    sectionCounter: (current, total) => `第 ${current} 部分，共 ${total} 部分`,
    skippedLabel: "已跳过",
    skipButton: "跳过",
    saveResponseButton: "保存回答",
    completeButton: "完成",
    buildingSummaryLabel: "正在生成摘要...",
    textareaPlaceholder: "请写下另一位照护者最需要知道的内容……",
    allQuestionsAnswered: "所有问题都已回答。",
    recordResponseTitle: "录制回答",
    spokenLanguageLabel: "口语语言",
    recordButton: "录制回答",
    stopRecordingButton: "停止录音",
    audioLimitNotice: "每段录音请控制在 45 秒以内。",
    audioNotSupported: "此处不支持录音。",
    noSpeechDetected: "未检测到语音。您可以再试一次，或直接输入回答。",
    recordingTooShort: "录音时间太短。请重试，或直接输入回答。",
    recordingTooLarge: "这段录音太长。请将每段录音控制在 45 秒以内，或把剩余内容直接输入。",
    unableToTranscribe: "无法转录音频。",
    unableToStartRecording: "无法开始录音。",
    unableToFinishRecording: "无法完成录音。",
    unableToGenerateSummary: "无法生成摘要。",
    promptCounter: (current, total) => `问题 ${current} / ${total}`,
    audioReady: (languageLabel, isEnglish = languageLabel === "英语") =>
      isEnglish
        ? "语音会先转成文字再保存。"
        : `${languageLabel}语音会先翻译成英文再保存。`,
    audioTranscribing: (languageLabel, isEnglish) =>
      isEnglish
        ? "语音会转换成可编辑文字。"
        : `正在把${languageLabel}语音转换成可编辑的英文文字。`,
    audioAdded: (isEnglish) =>
      isEnglish
        ? "转录内容已加入回答框，保存前可以编辑。"
        : "英文译文已加入回答框，保存前可以编辑。",
    audioLimitReached: (languageLabel, isEnglish) =>
      isEnglish
        ? "已达到 45 秒上限。现在开始转录；如果转录服务正忙，系统会自动重试。"
        : `已达到 45 秒上限。现在开始把${languageLabel}语音翻译成英文；如果转录服务正忙，系统会自动重试。`,
    recordingStatus: (current, max) => `正在录音 ${current} / ${max}。`
  }
};

const resetPasswordCopy: Record<UiLanguage, ResetPasswordCopy> = {
  english: {
    title: "Set a new password",
    subtitle: "Choose a new password for your account.",
    checkingLink: "Checking reset link...",
    passwordLabel: "New password",
    confirmPasswordLabel: "Confirm new password",
    saveButton: "Save new password",
    savingButton: "Saving...",
    successMessage: "Password updated. You can return to the app now.",
    invalidLinkMessage: "This reset link is invalid or expired. Request a new password reset email.",
    passwordMismatch: "Passwords must match.",
    passwordRequired: "Enter a new password.",
    confirmPasswordRequired: "Confirm your new password.",
    updateFailed: "Unable to update the password right now.",
    backToSignIn: "Back to sign in"
  },
  spanish: {
    title: "Crear una nueva contraseña",
    subtitle: "Elija una nueva contraseña para su cuenta.",
    checkingLink: "Verificando enlace de restablecimiento...",
    passwordLabel: "Nueva contraseña",
    confirmPasswordLabel: "Confirmar nueva contraseña",
    saveButton: "Guardar nueva contraseña",
    savingButton: "Guardando...",
    successMessage: "La contraseña se actualizó. Ya puede volver a la aplicación.",
    invalidLinkMessage:
      "Este enlace para restablecer la contraseña no es válido o venció. Solicite uno nuevo.",
    passwordMismatch: "Las contraseñas deben coincidir.",
    passwordRequired: "Ingrese una nueva contraseña.",
    confirmPasswordRequired: "Confirme su nueva contraseña.",
    updateFailed: "No fue posible actualizar la contraseña en este momento.",
    backToSignIn: "Volver al inicio de sesión"
  },
  mandarin: {
    title: "设置新密码",
    subtitle: "请为您的账号设置一个新密码。",
    checkingLink: "正在检查重置链接...",
    passwordLabel: "新密码",
    confirmPasswordLabel: "确认新密码",
    saveButton: "保存新密码",
    savingButton: "正在保存...",
    successMessage: "密码已更新。现在可以返回应用继续使用。",
    invalidLinkMessage: "此重置链接无效或已过期。请重新申请密码重置邮件。",
    passwordMismatch: "两次输入的密码必须一致。",
    passwordRequired: "请输入新密码。",
    confirmPasswordRequired: "请确认您的新密码。",
    updateFailed: "暂时无法更新密码。",
    backToSignIn: "返回登录"
  }
};

const reviewCopy: Record<UiLanguage, ReviewCopy> = {
  english: {
    title: "Review and edit",
    subtitle: "Review the AI-organized handoff below. You can edit the title, overview, and sections before saving.",
    generatedAtLabel: "Summary created",
    backToQuestionsButton: "Back to questions",
    regenerateHint: "Need to add more context? Go back to the questions, add details, and complete again to regenerate this summary.",
    summaryTitleLabel: "Summary title",
    overviewLabel: "Overview",
    sectionsLabel: "Handoff sections",
    sectionTitleLabel: "Section title",
    sectionItemsLabel: "Section details",
    sectionTitlePlaceholder: "For example: Communication",
    sectionItemsPlaceholder: "One bullet per line",
    removeSectionButton: "Remove section",
    saveButton: "Confirm and save",
    savingButton: "Saving...",
    saveFailed: "Save failed.",
    confirmFailed: "Unable to save the confirmed summary."
  },
  spanish: {
    title: "Revisar y editar",
    subtitle: "Revise el resumen organizado por IA. Puede editar el título, el resumen general y las secciones antes de guardar.",
    generatedAtLabel: "Resumen creado",
    backToQuestionsButton: "Volver a las preguntas",
    regenerateHint:
      "¿Necesita agregar más contexto? Vuelva a las preguntas, agregue detalles y complete de nuevo para regenerar este resumen.",
    summaryTitleLabel: "Título del resumen",
    overviewLabel: "Resumen general",
    sectionsLabel: "Secciones del relevo",
    sectionTitleLabel: "Título de la sección",
    sectionItemsLabel: "Detalles de la sección",
    sectionTitlePlaceholder: "Por ejemplo: Comunicación",
    sectionItemsPlaceholder: "Una viñeta por línea",
    removeSectionButton: "Eliminar sección",
    saveButton: "Confirmar y guardar",
    savingButton: "Guardando...",
    saveFailed: "No fue posible guardar.",
    confirmFailed: "No fue posible guardar el resumen confirmado."
  },
  mandarin: {
    title: "审核并编辑",
    subtitle: "请查看下方由 AI 整理的交接摘要。保存最终版本前，您可以编辑标题、概览和各个部分。",
    generatedAtLabel: "摘要创建时间",
    backToQuestionsButton: "返回问题页",
    regenerateHint: "如果还想补充更多背景，请返回问题页添加内容，然后再次完成以重新生成摘要。",
    summaryTitleLabel: "摘要标题",
    overviewLabel: "概览",
    sectionsLabel: "交接部分",
    sectionTitleLabel: "部分标题",
    sectionItemsLabel: "部分内容",
    sectionTitlePlaceholder: "例如：沟通方式",
    sectionItemsPlaceholder: "每行一条要点",
    removeSectionButton: "删除部分",
    saveButton: "确认并保存",
    savingButton: "正在保存...",
    saveFailed: "保存失败。",
    confirmFailed: "无法保存已确认的摘要。"
  }
};

const completionCopy: Record<UiLanguage, CompletionCopy> = {
  english: {
    emptyTitle: "Completion",
    emptySubtitle: "The saved summary will appear here after confirmation.",
    emptyMessage: "No saved summary is available yet.",
    title: "Summary saved",
    subtitle:
      "This view shows the final edited summary, allows a browser PDF export, and collects lightweight feedback.",
    generatedAtLabel: "Summary created",
    backToQuestionsButton: "Back to questions",
    regenerateHint: "If you remember more details later, go back to the questions, add them, and complete again to regenerate the summary.",
    overviewLabel: "Overview",
    downloadPdfButton: "Download as PDF",
    emailPdfTitle: "Send PDF by email",
    emailPdfSubtitle: "We’ll attach this summary as a PDF. You can keep your email here or type another one.",
    recipientEmailLabel: "Recipient email",
    recipientEmailPlaceholder: "caregiver@example.com",
    sendPdfButton: "Send PDF",
    sendingPdfButton: "Sending PDF...",
    emailSent: (email) => `Summary PDF sent to ${email}.`,
    emailSendFailed: "Unable to send the PDF right now.",
    feedbackLabel: "How useful was this?",
    feedbackPlaceholder: "For example: very useful, somewhat useful, not useful",
    commentsLabel: "Comments",
    saveFeedbackButton: "Save feedback",
    feedbackSaved: "Feedback saved.",
    feedbackSaveFailed: "Unable to save feedback right now."
  },
  spanish: {
    emptyTitle: "Finalización",
    emptySubtitle: "El resumen guardado aparecerá aquí después de la confirmación.",
    emptyMessage: "Todavía no hay un resumen guardado.",
    title: "Resumen guardado",
    subtitle:
      "Aquí verá el resumen final editado, podrá exportarlo como PDF desde el navegador y dejar comentarios breves.",
    generatedAtLabel: "Resumen creado",
    backToQuestionsButton: "Volver a las preguntas",
    regenerateHint:
      "Si luego recuerda más detalles, vuelva a las preguntas, agréguelos y complete de nuevo para regenerar el resumen.",
    overviewLabel: "Resumen general",
    downloadPdfButton: "Descargar como PDF",
    emailPdfTitle: "Enviar PDF por correo",
    emailPdfSubtitle:
      "Adjuntaremos este resumen como PDF. Puede dejar su correo o escribir otro.",
    recipientEmailLabel: "Correo del destinatario",
    recipientEmailPlaceholder: "cuidador@ejemplo.com",
    sendPdfButton: "Enviar PDF",
    sendingPdfButton: "Enviando PDF...",
    emailSent: (email) => `El PDF del resumen se envió a ${email}.`,
    emailSendFailed: "No fue posible enviar el PDF en este momento.",
    feedbackLabel: "¿Qué tan útil fue esto?",
    feedbackPlaceholder: "Por ejemplo: muy útil, algo útil, poco útil",
    commentsLabel: "Comentarios",
    saveFeedbackButton: "Guardar comentarios",
    feedbackSaved: "Comentarios guardados.",
    feedbackSaveFailed: "No fue posible guardar los comentarios en este momento."
  },
  mandarin: {
    emptyTitle: "完成",
    emptySubtitle: "确认后，已保存的摘要会显示在这里。",
    emptyMessage: "目前还没有已保存的摘要。",
    title: "摘要已保存",
    subtitle: "这里会显示最终编辑后的摘要，您也可以导出 PDF，并留下简短反馈。",
    generatedAtLabel: "摘要创建时间",
    backToQuestionsButton: "返回问题页",
    regenerateHint: "如果之后想起更多细节，可以返回问题页补充内容，然后再次完成以重新生成摘要。",
    overviewLabel: "概览",
    downloadPdfButton: "下载 PDF",
    emailPdfTitle: "通过邮件发送 PDF",
    emailPdfSubtitle: "我们会把这份摘要作为 PDF 附件发送。您可以保留当前邮箱，或改填其他邮箱。",
    recipientEmailLabel: "收件邮箱",
    recipientEmailPlaceholder: "caregiver@example.com",
    sendPdfButton: "发送 PDF",
    sendingPdfButton: "正在发送 PDF...",
    emailSent: (email) => `摘要 PDF 已发送到 ${email}。`,
    emailSendFailed: "暂时无法发送 PDF。",
    feedbackLabel: "这份内容对您有多大帮助？",
    feedbackPlaceholder: "例如：非常有帮助、有些帮助、没有帮助",
    commentsLabel: "意见",
    saveFeedbackButton: "保存反馈",
    feedbackSaved: "反馈已保存。",
    feedbackSaveFailed: "暂时无法保存反馈。"
  }
};

const promptDefinitions: Array<{
  id: string;
  sectionId: ReflectionPrompt["sectionId"];
  translations: Record<UiLanguage, PromptTranslation>;
}> = [
  {
    id: "communication-how-do-they-communicate",
    sectionId: "what_helps_the_day_go_well",
    translations: {
      english: {
        sectionTitle: "What helps the day go well",
        stepId: "communication",
        stepTitle: "Communication",
        stepSubtitle: "Answer what you can — short examples help.",
        stepCompletionMessage: "You just created a communication guide for your loved one.",
        promptLabel: "How do they communicate?",
        question: "How do they communicate?",
        examples: [
          "words",
          "sounds",
          "gestures",
          "pointing",
          "leading you",
          "pictures",
          "communication device",
          "writing"
        ]
      },
      spanish: {
        sectionTitle: "Lo que ayuda a que el día vaya bien",
        stepId: "communication",
        stepTitle: "Comunicación",
        stepSubtitle: "Responda lo que pueda; los ejemplos cortos ayudan.",
        stepCompletionMessage: "Acaba de crear una guía de comunicación para su ser querido.",
        promptLabel: "¿Cómo se comunican?",
        question: "¿Cómo se comunican?",
        examples: [
          "palabras",
          "sonidos",
          "gestos",
          "señalar",
          "llevarle hacia algo",
          "imágenes",
          "dispositivo de comunicación",
          "escritura"
        ]
      },
      mandarin: {
        sectionTitle: "什么有助于让一天顺利进行",
        stepId: "communication",
        stepTitle: "沟通",
        stepSubtitle: "能回答多少就回答多少，简短例子会有帮助。",
        stepCompletionMessage: "您刚刚为您的亲人创建了一份沟通指南。",
        promptLabel: "他们如何沟通？",
        question: "他们如何沟通？",
        examples: [
          "词语",
          "声音",
          "手势",
          "指东西",
          "带你去某处",
          "图片",
          "沟通设备",
          "书写"
        ]
      }
    }
  },
  {
    id: "communication-what-do-specific-things-mean",
    sectionId: "what_helps_the_day_go_well",
    translations: {
      english: {
        sectionTitle: "What helps the day go well",
        stepId: "communication",
        stepTitle: "Communication",
        stepSubtitle: "Answer what you can — short examples help.",
        stepCompletionMessage: "You just created a communication guide for your loved one.",
        promptLabel: "Are there things they say or do that mean something specific? What do they mean?",
        question: "Are there things they say or do that mean something specific? What do they mean?",
        examples: [
          "leading you = wants something",
          "sitting close = wants attention",
          "repeating a phrase = anxious or excited"
        ]
      },
      spanish: {
        sectionTitle: "Lo que ayuda a que el día vaya bien",
        stepId: "communication",
        stepTitle: "Comunicación",
        stepSubtitle: "Responda lo que pueda; los ejemplos cortos ayudan.",
        stepCompletionMessage: "Acaba de crear una guía de comunicación para su ser querido.",
        promptLabel: "¿Hay cosas que dicen o hacen que significan algo específico? ¿Qué significan?",
        question:
          "¿Hay cosas que dicen o hacen que significan algo específico? ¿Qué significan?",
        examples: [
          "llevarle hacia algo = quiere algo",
          "sentarse cerca = quiere atención",
          "repetir una frase = está ansioso o emocionado"
        ]
      },
      mandarin: {
        sectionTitle: "什么有助于让一天顺利进行",
        stepId: "communication",
        stepTitle: "沟通",
        stepSubtitle: "能回答多少就回答多少，简短例子会有帮助。",
        stepCompletionMessage: "您刚刚为您的亲人创建了一份沟通指南。",
        promptLabel: "他们有没有某些话或行为有特定含义？分别是什么意思？",
        question: "他们有没有某些话或行为有特定含义？分别是什么意思？",
        examples: [
          "带你过去 = 他们想要某样东西",
          "坐得很近 = 他们想要关注",
          "重复一句话 = 焦虑或兴奋"
        ]
      }
    }
  },
  {
    id: "communication-what-helps-you-communicate",
    sectionId: "what_helps_the_day_go_well",
    translations: {
      english: {
        sectionTitle: "What helps the day go well",
        stepId: "communication",
        stepTitle: "Communication",
        stepSubtitle: "Answer what you can — short examples help.",
        stepCompletionMessage: "You just created a communication guide for your loved one.",
        promptLabel: "What helps you communicate with them?",
        question: "What helps you communicate with them?",
        examples: [
          "giving choices instead of open-ended questions",
          "waiting before repeating",
          "using written questions or images"
        ]
      },
      spanish: {
        sectionTitle: "Lo que ayuda a que el día vaya bien",
        stepId: "communication",
        stepTitle: "Comunicación",
        stepSubtitle: "Responda lo que pueda; los ejemplos cortos ayudan.",
        stepCompletionMessage: "Acaba de crear una guía de comunicación para su ser querido.",
        promptLabel: "¿Qué le ayuda a comunicarse con ellos?",
        question: "¿Qué le ayuda a comunicarse con ellos?",
        examples: [
          "dar opciones en lugar de preguntas abiertas",
          "esperar antes de repetir",
          "usar preguntas escritas o imágenes"
        ]
      },
      mandarin: {
        sectionTitle: "什么有助于让一天顺利进行",
        stepId: "communication",
        stepTitle: "沟通",
        stepSubtitle: "能回答多少就回答多少，简短例子会有帮助。",
        stepCompletionMessage: "您刚刚为您的亲人创建了一份沟通指南。",
        promptLabel: "什么方式有助于你与他们沟通？",
        question: "什么方式有助于你与他们沟通？",
        examples: [
          "给选择题而不是开放式问题",
          "重复前先等一等",
          "使用书面问题或图片"
        ]
      }
    }
  },
  {
    id: "communication-how-can-you-tell-they-need-help",
    sectionId: "what_helps_the_day_go_well",
    translations: {
      english: {
        sectionTitle: "What helps the day go well",
        stepId: "communication",
        stepTitle: "Communication",
        stepSubtitle: "Answer what you can — short examples help.",
        stepCompletionMessage: "You just created a communication guide for your loved one.",
        promptLabel: "How can you tell when they need help, and what should you check first?",
        question: "How can you tell when they need help, and what should you check first?",
        examples: [
          "quieter than usual",
          "not responding → check device, environment, or if they can find what they need"
        ]
      },
      spanish: {
        sectionTitle: "Lo que ayuda a que el día vaya bien",
        stepId: "communication",
        stepTitle: "Comunicación",
        stepSubtitle: "Responda lo que pueda; los ejemplos cortos ayudan.",
        stepCompletionMessage: "Acaba de crear una guía de comunicación para su ser querido.",
        promptLabel: "¿Cómo puede saber que necesitan ayuda y qué debería revisar primero?",
        question:
          "¿Cómo puede saber que necesitan ayuda y qué debería revisar primero?",
        examples: [
          "más callados de lo habitual",
          "si no responden → revise el dispositivo, el entorno o si pueden encontrar lo que necesitan"
        ]
      },
      mandarin: {
        sectionTitle: "什么有助于让一天顺利进行",
        stepId: "communication",
        stepTitle: "沟通",
        stepSubtitle: "能回答多少就回答多少，简短例子会有帮助。",
        stepCompletionMessage: "您刚刚为您的亲人创建了一份沟通指南。",
        promptLabel: "你如何判断他们需要帮助？首先应该检查什么？",
        question: "你如何判断他们需要帮助？首先应该检查什么？",
        examples: [
          "比平时更安静",
          "没有回应 → 先检查设备、环境，或他们是否找得到自己需要的东西"
        ]
      }
    }
  },
  {
    id: "health-safety-medical-info",
    sectionId: "what_helps_the_day_go_well",
    translations: {
      english: {
        sectionTitle: "What helps the day go well",
        stepId: "health_safety",
        stepTitle: "Health & Safety",
        stepSubtitle: "Answer what you can — short examples help.",
        stepCompletionMessage: "You just created a health and safety guide for your loved one.",
        promptLabel: "Are there any allergies?",
        question: "Are there any allergies?",
        examples: [
          "food",
          "medication",
          "animals"
        ]
      },
      spanish: {
        sectionTitle: "Lo que ayuda a que el día vaya bien",
        stepId: "health_safety",
        stepTitle: "Salud y seguridad",
        stepSubtitle: "Responda lo que pueda; los ejemplos cortos ayudan.",
        stepCompletionMessage: "Acaba de crear una guía de salud y seguridad para su ser querido.",
        promptLabel: "¿Tienen alguna alergia?",
        question: "¿Tienen alguna alergia?",
        examples: [
          "alimentos",
          "medicamentos",
          "animales"
        ]
      },
      mandarin: {
        sectionTitle: "什么有助于让一天顺利进行",
        stepId: "health_safety",
        stepTitle: "健康与安全",
        stepSubtitle: "能回答多少就回答多少，简短例子会有帮助。",
        stepCompletionMessage: "您刚刚为您的亲人创建了一份健康与安全指南。",
        promptLabel: "他们有过敏吗？",
        question: "他们有过敏吗？",
        examples: [
          "食物",
          "药物",
          "动物"
        ]
      }
    }
  },
  {
    id: "health-safety-medications-routines",
    sectionId: "what_helps_the_day_go_well",
    translations: {
      english: {
        sectionTitle: "What helps the day go well",
        stepId: "health_safety",
        stepTitle: "Health & Safety",
        stepSubtitle: "Answer what you can — short examples help.",
        stepCompletionMessage: "You just created a health and safety guide for your loved one.",
        promptLabel: "Do they have any health conditions?",
        question: "Do they have any health conditions?",
        examples: [
          "seizures",
          "asthma",
          "diabetes",
          "GI issues"
        ]
      },
      spanish: {
        sectionTitle: "Lo que ayuda a que el día vaya bien",
        stepId: "health_safety",
        stepTitle: "Salud y seguridad",
        stepSubtitle: "Responda lo que pueda; los ejemplos cortos ayudan.",
        stepCompletionMessage: "Acaba de crear una guía de salud y seguridad para su ser querido.",
        promptLabel: "¿Tienen alguna condición de salud?",
        question: "¿Tienen alguna condición de salud?",
        examples: [
          "convulsiones",
          "asma",
          "diabetes",
          "problemas gastrointestinales"
        ]
      },
      mandarin: {
        sectionTitle: "什么有助于让一天顺利进行",
        stepId: "health_safety",
        stepTitle: "健康与安全",
        stepSubtitle: "能回答多少就回答多少，简短例子会有帮助。",
        stepCompletionMessage: "您刚刚为您的亲人创建了一份健康与安全指南。",
        promptLabel: "他们有任何健康状况吗？",
        question: "他们有任何健康状况吗？",
        examples: [
          "癫痫",
          "哮喘",
          "糖尿病",
          "胃肠问题"
        ]
      }
    }
  },
  {
    id: "health-safety-equipment-supports",
    sectionId: "what_helps_the_day_go_well",
    translations: {
      english: {
        sectionTitle: "What helps the day go well",
        stepId: "health_safety",
        stepTitle: "Health & Safety",
        stepSubtitle: "Answer what you can — short examples help.",
        stepCompletionMessage: "You just created a health and safety guide for your loved one.",
        promptLabel: "Do they take any medication? What should others know?",
        question: "Do they take any medication? What should others know?",
        examples: [
          "time of day",
          "with food",
          "crushed",
          "liquid",
          "needs reminders"
        ]
      },
      spanish: {
        sectionTitle: "Lo que ayuda a que el día vaya bien",
        stepId: "health_safety",
        stepTitle: "Salud y seguridad",
        stepSubtitle: "Responda lo que pueda; los ejemplos cortos ayudan.",
        stepCompletionMessage: "Acaba de crear una guía de salud y seguridad para su ser querido.",
        promptLabel: "¿Toman algún medicamento? ¿Qué deben saber otras personas?",
        question: "¿Toman algún medicamento? ¿Qué deben saber otras personas?",
        examples: [
          "hora del día",
          "con comida",
          "triturado",
          "líquido",
          "necesita recordatorios"
        ]
      },
      mandarin: {
        sectionTitle: "什么有助于让一天顺利进行",
        stepId: "health_safety",
        stepTitle: "健康与安全",
        stepSubtitle: "能回答多少就回答多少，简短例子会有帮助。",
        stepCompletionMessage: "您刚刚为您的亲人创建了一份健康与安全指南。",
        promptLabel: "他们会服用任何药物吗？其他人需要知道什么？",
        question: "他们会服用任何药物吗？其他人需要知道什么？",
        examples: [
          "一天中的什么时间",
          "是否要随餐",
          "是否要压碎",
          "液体",
          "是否需要提醒"
        ]
      }
    }
  },
  {
    id: "health-safety-safety-concerns",
    sectionId: "what_helps_the_day_go_well",
    translations: {
      english: {
        sectionTitle: "What helps the day go well",
        stepId: "health_safety",
        stepTitle: "Health & Safety",
        stepSubtitle: "Answer what you can — short examples help.",
        stepCompletionMessage: "You just created a health and safety guide for your loved one.",
        promptLabel: "Do they use any equipment or supports?",
        question: "Do they use any equipment or supports?",
        examples: [
          "glasses",
          "hearing aids",
          "wheelchair",
          "feeding tube",
          "braces"
        ]
      },
      spanish: {
        sectionTitle: "Lo que ayuda a que el día vaya bien",
        stepId: "health_safety",
        stepTitle: "Salud y seguridad",
        stepSubtitle: "Responda lo que pueda; los ejemplos cortos ayudan.",
        stepCompletionMessage: "Acaba de crear una guía de salud y seguridad para su ser querido.",
        promptLabel: "¿Usan algún equipo o apoyo?",
        question: "¿Usan algún equipo o apoyo?",
        examples: [
          "gafas",
          "audífonos",
          "silla de ruedas",
          "sonda de alimentación",
          "férulas"
        ]
      },
      mandarin: {
        sectionTitle: "什么有助于让一天顺利进行",
        stepId: "health_safety",
        stepTitle: "健康与安全",
        stepSubtitle: "能回答多少就回答多少，简短例子会有帮助。",
        stepCompletionMessage: "您刚刚为您的亲人创建了一份健康与安全指南。",
        promptLabel: "他们会使用任何设备或辅助工具吗？",
        question: "他们会使用任何设备或辅助工具吗？",
        examples: [
          "眼镜",
          "助听器",
          "轮椅",
          "喂食管",
          "支具"
        ]
      }
    }
  },
  {
    id: "daily-schedule-mornings",
    sectionId: "what_helps_the_day_go_well",
    translations: {
      english: {
        sectionTitle: "What helps the day go well",
        stepId: "daily_schedule",
        stepTitle: "Daily Schedule",
        stepSubtitle: "Answer what you can — short examples help.",
        stepCompletionMessage: "You just created a daily routine guide for your loved one.",
        promptLabel: "What is their typical morning routine?",
        question: "What is their typical morning routine?",
        examples: [
          "bathroom",
          "breakfast before medication",
          "brush teeth"
        ]
      },
      spanish: {
        sectionTitle: "Lo que ayuda a que el día vaya bien",
        stepId: "daily_schedule",
        stepTitle: "Rutina diaria",
        stepSubtitle: "Responda lo que pueda; los ejemplos cortos ayudan.",
        stepCompletionMessage: "Acaba de crear una guía de rutina diaria para su ser querido.",
        promptLabel: "¿Cuál es su rutina típica por la mañana?",
        question: "¿Cuál es su rutina típica por la mañana?",
        examples: [
          "baño",
          "desayuno antes del medicamento",
          "cepillarse los dientes"
        ]
      },
      mandarin: {
        sectionTitle: "什么有助于让一天顺利进行",
        stepId: "daily_schedule",
        stepTitle: "日常安排",
        stepSubtitle: "能回答多少就回答多少，简短例子会有帮助。",
        stepCompletionMessage: "您刚刚为您的亲人创建了一份日常安排指南。",
        promptLabel: "他们早上的典型流程是什么？",
        question: "他们早上的典型流程是什么？",
        examples: [
          "上厕所",
          "吃药前先吃早餐",
          "刷牙"
        ]
      }
    }
  },
  {
    id: "daily-schedule-meals-snacks",
    sectionId: "what_helps_the_day_go_well",
    translations: {
      english: {
        sectionTitle: "What helps the day go well",
        stepId: "daily_schedule",
        stepTitle: "Daily Schedule",
        stepSubtitle: "Answer what you can — short examples help.",
        stepCompletionMessage: "You just created a daily routine guide for your loved one.",
        promptLabel: "What are meals and snacks like?",
        question: "What are meals and snacks like?",
        examples: [
          "times",
          "preferred foods",
          "routines"
        ]
      },
      spanish: {
        sectionTitle: "Lo que ayuda a que el día vaya bien",
        stepId: "daily_schedule",
        stepTitle: "Rutina diaria",
        stepSubtitle: "Responda lo que pueda; los ejemplos cortos ayudan.",
        stepCompletionMessage: "Acaba de crear una guía de rutina diaria para su ser querido.",
        promptLabel: "¿Cómo son las comidas y meriendas?",
        question: "¿Cómo son las comidas y meriendas?",
        examples: [
          "horarios",
          "comidas preferidas",
          "rutinas"
        ]
      },
      mandarin: {
        sectionTitle: "什么有助于让一天顺利进行",
        stepId: "daily_schedule",
        stepTitle: "日常安排",
        stepSubtitle: "能回答多少就回答多少，简短例子会有帮助。",
        stepCompletionMessage: "您刚刚为您的亲人创建了一份日常安排指南。",
        promptLabel: "他们的正餐和点心通常是什么样的？",
        question: "他们的正餐和点心通常是什么样的？",
        examples: [
          "时间",
          "喜欢的食物",
          "固定习惯"
        ]
      }
    }
  },
  {
    id: "daily-schedule-transitions",
    sectionId: "what_helps_the_day_go_well",
    translations: {
      english: {
        sectionTitle: "What helps the day go well",
        stepId: "daily_schedule",
        stepTitle: "Daily Schedule",
        stepSubtitle: "Answer what you can — short examples help.",
        stepCompletionMessage: "You just created a daily routine guide for your loved one.",
        promptLabel: "What helps with transitions during the day?",
        question: "What helps with transitions during the day?",
        examples: [
          "countdown",
          "\"5 more minutes\"",
          "visual schedule"
        ]
      },
      spanish: {
        sectionTitle: "Lo que ayuda a que el día vaya bien",
        stepId: "daily_schedule",
        stepTitle: "Rutina diaria",
        stepSubtitle: "Responda lo que pueda; los ejemplos cortos ayudan.",
        stepCompletionMessage: "Acaba de crear una guía de rutina diaria para su ser querido.",
        promptLabel: "¿Qué ayuda con las transiciones durante el día?",
        question: "¿Qué ayuda con las transiciones durante el día?",
        examples: [
          "cuenta regresiva",
          "\"5 minutos más\"",
          "horario visual"
        ]
      },
      mandarin: {
        sectionTitle: "什么有助于让一天顺利进行",
        stepId: "daily_schedule",
        stepTitle: "日常安排",
        stepSubtitle: "能回答多少就回答多少，简短例子会有帮助。",
        stepCompletionMessage: "您刚刚为您的亲人创建了一份日常安排指南。",
        promptLabel: "白天过渡转换时，什么会有帮助？",
        question: "白天过渡转换时，什么会有帮助？",
        examples: [
          "倒计时",
          "\"再五分钟\"",
          "视觉日程表"
        ]
      }
    }
  },
  {
    id: "daily-schedule-daytime-activities",
    sectionId: "what_helps_the_day_go_well",
    translations: {
      english: {
        sectionTitle: "What helps the day go well",
        stepId: "daily_schedule",
        stepTitle: "Daily Schedule",
        stepSubtitle: "Answer what you can — short examples help.",
        stepCompletionMessage: "You just created a daily routine guide for your loved one.",
        promptLabel: "What do they like to do during the day?",
        question: "What do they like to do during the day?",
        examples: [
          "walks",
          "iPad time",
          "sensory swing",
          "activities"
        ]
      },
      spanish: {
        sectionTitle: "Lo que ayuda a que el día vaya bien",
        stepId: "daily_schedule",
        stepTitle: "Rutina diaria",
        stepSubtitle: "Responda lo que pueda; los ejemplos cortos ayudan.",
        stepCompletionMessage: "Acaba de crear una guía de rutina diaria para su ser querido.",
        promptLabel: "¿Qué les gusta hacer durante el día?",
        question: "¿Qué les gusta hacer durante el día?",
        examples: [
          "caminatas",
          "tiempo con la tableta",
          "columpio sensorial",
          "actividades"
        ]
      },
      mandarin: {
        sectionTitle: "什么有助于让一天顺利进行",
        stepId: "daily_schedule",
        stepTitle: "日常安排",
        stepSubtitle: "能回答多少就回答多少，简短例子会有帮助。",
        stepCompletionMessage: "您刚刚为您的亲人创建了一份日常安排指南。",
        promptLabel: "他们白天喜欢做什么？",
        question: "他们白天喜欢做什么？",
        examples: [
          "散步",
          "iPad时间",
          "感官秋千",
          "活动"
        ]
      }
    }
  },
  {
    id: "daily-schedule-bedtime",
    sectionId: "what_helps_the_day_go_well",
    translations: {
      english: {
        sectionTitle: "What helps the day go well",
        stepId: "daily_schedule",
        stepTitle: "Daily Schedule",
        stepSubtitle: "Answer what you can — short examples help.",
        stepCompletionMessage: "You just created a daily routine guide for your loved one.",
        promptLabel: "What is their bedtime routine?",
        question: "What is their bedtime routine?",
        examples: [
          "bath or shower",
          "story",
          "music"
        ]
      },
      spanish: {
        sectionTitle: "Lo que ayuda a que el día vaya bien",
        stepId: "daily_schedule",
        stepTitle: "Rutina diaria",
        stepSubtitle: "Responda lo que pueda; los ejemplos cortos ayudan.",
        stepCompletionMessage: "Acaba de crear una guía de rutina diaria para su ser querido.",
        promptLabel: "¿Cuál es su rutina para ir a dormir?",
        question: "¿Cuál es su rutina para ir a dormir?",
        examples: [
          "baño o ducha",
          "cuento",
          "música"
        ]
      },
      mandarin: {
        sectionTitle: "什么有助于让一天顺利进行",
        stepId: "daily_schedule",
        stepTitle: "日常安排",
        stepSubtitle: "能回答多少就回答多少，简短例子会有帮助。",
        stepCompletionMessage: "您刚刚为您的亲人创建了一份日常安排指南。",
        promptLabel: "他们的睡前流程是什么？",
        question: "他们的睡前流程是什么？",
        examples: [
          "洗澡或淋浴",
          "故事",
          "音乐"
        ]
      }
    }
  },
  {
    id: "activities-preferences-during-the-day",
    sectionId: "what_helps_the_day_go_well",
    translations: {
      english: {
        sectionTitle: "What helps the day go well",
        stepId: "activities_preferences",
        stepTitle: "Activities & Preferences",
        stepSubtitle: "Answer what you can — short examples help.",
        stepCompletionMessage: "You just created an activities and preferences guide for your loved one.",
        promptLabel: "What do they enjoy doing during the day?",
        question: "What do they enjoy doing during the day?",
        examples: [
          "sports",
          "crafts",
          "games",
          "music",
          "videos",
          "iPad"
        ]
      },
      spanish: {
        sectionTitle: "Lo que ayuda a que el día vaya bien",
        stepId: "activities_preferences",
        stepTitle: "Actividades y preferencias",
        stepSubtitle: "Responda lo que pueda; los ejemplos cortos ayudan.",
        stepCompletionMessage: "Acaba de crear una guía de actividades y preferencias para su ser querido.",
        promptLabel: "¿Qué les gusta hacer durante el día?",
        question: "¿Qué les gusta hacer durante el día?",
        examples: [
          "deportes",
          "manualidades",
          "juegos",
          "música",
          "videos",
          "tableta"
        ]
      },
      mandarin: {
        sectionTitle: "什么有助于让一天顺利进行",
        stepId: "activities_preferences",
        stepTitle: "活动与偏好",
        stepSubtitle: "能回答多少就回答多少，简短例子会有帮助。",
        stepCompletionMessage: "您刚刚为您的亲人创建了一份活动与偏好指南。",
        promptLabel: "他们白天喜欢做什么？",
        question: "他们白天喜欢做什么？",
        examples: [
          "运动",
          "手工",
          "游戏",
          "音乐",
          "视频",
          "iPad"
        ]
      }
    }
  },
  {
    id: "activities-preferences-outings",
    sectionId: "what_helps_the_day_go_well",
    translations: {
      english: {
        sectionTitle: "What helps the day go well",
        stepId: "activities_preferences",
        stepTitle: "Activities & Preferences",
        stepSubtitle: "Answer what you can — short examples help.",
        stepCompletionMessage: "You just created an activities and preferences guide for your loved one.",
        promptLabel: "What do they enjoy doing outside the home?",
        question: "What do they enjoy doing outside the home?",
        examples: [
          "walks",
          "stores",
          "car rides"
        ]
      },
      spanish: {
        sectionTitle: "Lo que ayuda a que el día vaya bien",
        stepId: "activities_preferences",
        stepTitle: "Actividades y preferencias",
        stepSubtitle: "Responda lo que pueda; los ejemplos cortos ayudan.",
        stepCompletionMessage: "Acaba de crear una guía de actividades y preferencias para su ser querido.",
        promptLabel: "¿Qué les gusta hacer fuera de casa?",
        question: "¿Qué les gusta hacer fuera de casa?",
        examples: [
          "caminatas",
          "tiendas",
          "paseos en coche"
        ]
      },
      mandarin: {
        sectionTitle: "什么有助于让一天顺利进行",
        stepId: "activities_preferences",
        stepTitle: "活动与偏好",
        stepSubtitle: "能回答多少就回答多少，简短例子会有帮助。",
        stepCompletionMessage: "您刚刚为您的亲人创建了一份活动与偏好指南。",
        promptLabel: "他们在家外喜欢做什么？",
        question: "他们在家外喜欢做什么？",
        examples: [
          "散步",
          "逛商店",
          "坐车兜风"
        ]
      }
    }
  },
  {
    id: "activities-preferences-favorite-activities",
    sectionId: "what_helps_the_day_go_well",
    translations: {
      english: {
        sectionTitle: "What helps the day go well",
        stepId: "activities_preferences",
        stepTitle: "Activities & Preferences",
        stepSubtitle: "Answer what you can — short examples help.",
        stepCompletionMessage: "You just created an activities and preferences guide for your loved one.",
        promptLabel: "What activities do they enjoy most?",
        question: "What activities do they enjoy most?",
        examples: [
          "sports",
          "crafts",
          "games",
          "music",
          "videos",
          "iPad"
        ]
      },
      spanish: {
        sectionTitle: "Lo que ayuda a que el día vaya bien",
        stepId: "activities_preferences",
        stepTitle: "Actividades y preferencias",
        stepSubtitle: "Responda lo que pueda; los ejemplos cortos ayudan.",
        stepCompletionMessage: "Acaba de crear una guía de actividades y preferencias para su ser querido.",
        promptLabel: "¿Qué actividades disfrutan más?",
        question: "¿Qué actividades disfrutan más?",
        examples: [
          "deportes",
          "manualidades",
          "juegos",
          "música",
          "videos",
          "tableta"
        ]
      },
      mandarin: {
        sectionTitle: "什么有助于让一天顺利进行",
        stepId: "activities_preferences",
        stepTitle: "活动与偏好",
        stepSubtitle: "能回答多少就回答多少，简短例子会有帮助。",
        stepCompletionMessage: "您刚刚为您的亲人创建了一份活动与偏好指南。",
        promptLabel: "他们最喜欢哪些活动？",
        question: "他们最喜欢哪些活动？",
        examples: [
          "运动",
          "手工",
          "游戏",
          "音乐",
          "视频",
          "iPad"
        ]
      }
    }
  },
  {
    id: "activities-preferences-trusted-people",
    sectionId: "what_helps_the_day_go_well",
    translations: {
      english: {
        sectionTitle: "What helps the day go well",
        stepId: "activities_preferences",
        stepTitle: "Activities & Preferences",
        stepSubtitle: "Answer what you can — short examples help.",
        stepCompletionMessage: "You just created an activities and preferences guide for your loved one.",
        promptLabel: "Who do they enjoy spending time with?",
        question: "Who do they enjoy spending time with?",
        examples: [
          "family",
          "friends",
          "pets",
          "caregivers"
        ]
      },
      spanish: {
        sectionTitle: "Lo que ayuda a que el día vaya bien",
        stepId: "activities_preferences",
        stepTitle: "Actividades y preferencias",
        stepSubtitle: "Responda lo que pueda; los ejemplos cortos ayudan.",
        stepCompletionMessage: "Acaba de crear una guía de actividades y preferencias para su ser querido.",
        promptLabel: "¿Con quién disfrutan pasar tiempo?",
        question: "¿Con quién disfrutan pasar tiempo?",
        examples: [
          "familia",
          "amistades",
          "mascotas",
          "cuidadores"
        ]
      },
      mandarin: {
        sectionTitle: "什么有助于让一天顺利进行",
        stepId: "activities_preferences",
        stepTitle: "活动与偏好",
        stepSubtitle: "能回答多少就回答多少，简短例子会有帮助。",
        stepCompletionMessage: "您刚刚为您的亲人创建了一份活动与偏好指南。",
        promptLabel: "他们喜欢和谁待在一起？",
        question: "他们喜欢和谁待在一起？",
        examples: [
          "家人",
          "朋友",
          "宠物",
          "照护者"
        ]
      }
    }
  },
  {
    id: "activities-preferences-quiet-time",
    sectionId: "what_helps_the_day_go_well",
    translations: {
      english: {
        sectionTitle: "What helps the day go well",
        stepId: "activities_preferences",
        stepTitle: "Activities & Preferences",
        stepSubtitle: "Answer what you can — short examples help.",
        stepCompletionMessage: "You just created an activities and preferences guide for your loved one.",
        promptLabel: "What does quiet or downtime look like for them?",
        question: "What does quiet or downtime look like for them?",
        examples: [
          "resting",
          "low lights",
          "sensory space"
        ]
      },
      spanish: {
        sectionTitle: "Lo que ayuda a que el día vaya bien",
        stepId: "activities_preferences",
        stepTitle: "Actividades y preferencias",
        stepSubtitle: "Responda lo que pueda; los ejemplos cortos ayudan.",
        stepCompletionMessage: "Acaba de crear una guía de actividades y preferencias para su ser querido.",
        promptLabel: "¿Cómo es para ellos el tiempo tranquilo o de descanso?",
        question: "¿Cómo es para ellos el tiempo tranquilo o de descanso?",
        examples: [
          "descansar",
          "luces bajas",
          "espacio sensorial"
        ]
      },
      mandarin: {
        sectionTitle: "什么有助于让一天顺利进行",
        stepId: "activities_preferences",
        stepTitle: "活动与偏好",
        stepSubtitle: "能回答多少就回答多少，简短例子会有帮助。",
        stepCompletionMessage: "您刚刚为您的亲人创建了一份活动与偏好指南。",
        promptLabel: "对他们来说，安静或休息时间通常是什么样的？",
        question: "对他们来说，安静或休息时间通常是什么样的？",
        examples: [
          "休息",
          "较暗的灯光",
          "感官空间"
        ]
      }
    }
  },
  {
    id: "upset-overwhelm-plan-changes",
    sectionId: "what_can_upset_or_overwhelm_them",
    translations: {
      english: {
        sectionTitle: "What can upset or overwhelm them",
        stepId: "upset_overwhelm",
        stepTitle: "What can upset or overwhelm them",
        stepSubtitle: "Answer what you can — short examples help.",
        stepCompletionMessage: "You just created a guide to what can upset or overwhelm your loved one.",
        promptLabel: "What changes in plans or routine tend to upset or overwhelm them?",
        question: "What changes in plans or routine tend to upset or overwhelm them?",
        examples: [
          "plans change without warning",
          "stopping an activity they enjoy",
          "switching activities too quickly",
          "unexpected visitors or outings"
        ]
      },
      spanish: {
        sectionTitle: "Qué puede molestarles o abrumarles",
        stepId: "upset_overwhelm",
        stepTitle: "Qué puede molestarles o abrumarles",
        stepSubtitle: "Responda lo que pueda; los ejemplos cortos ayudan.",
        stepCompletionMessage: "Acaba de crear una guía sobre lo que puede molestar o abrumar a su ser querido.",
        promptLabel: "¿Qué cambios en los planes o en la rutina tienden a molestarles o abrumarles?",
        question: "¿Qué cambios en los planes o en la rutina tienden a molestarles o abrumarles?",
        examples: [
          "los planes cambian sin aviso",
          "tener que parar una actividad que disfrutan",
          "cambiar de actividad demasiado rápido",
          "visitas o salidas inesperadas"
        ]
      },
      mandarin: {
        sectionTitle: "什么会让他们感到不安或不堪重负",
        stepId: "upset_overwhelm",
        stepTitle: "什么会让他们感到不安或不堪重负",
        stepSubtitle: "能回答多少就回答多少，简短例子会有帮助。",
        stepCompletionMessage: "您刚刚整理出一份关于什么会让您的亲人感到不安或不堪重负的指南。",
        promptLabel: "计划或日常安排中哪些变化容易让他们感到不安或不堪重负？",
        question: "计划或日常安排中哪些变化容易让他们感到不安或不堪重负？",
        examples: [
          "计划临时改变",
          "不得不中断他们喜欢的活动",
          "活动切换太快",
          "意外来访或临时外出"
        ]
      }
    }
  },
  {
    id: "upset-overwhelm-environment",
    sectionId: "what_can_upset_or_overwhelm_them",
    translations: {
      english: {
        sectionTitle: "What can upset or overwhelm them",
        stepId: "upset_overwhelm",
        stepTitle: "What can upset or overwhelm them",
        stepSubtitle: "Answer what you can — short examples help.",
        stepCompletionMessage: "You just created a guide to what can upset or overwhelm your loved one.",
        promptLabel: "What places or things around them can feel overwhelming?",
        question: "What places or things around them can feel overwhelming?",
        examples: [
          "loud noise",
          "bright lights",
          "crowded places",
          "strong smells",
          "too many people",
          "people too close",
          "unfamiliar people"
        ]
      },
      spanish: {
        sectionTitle: "Qué puede molestarles o abrumarles",
        stepId: "upset_overwhelm",
        stepTitle: "Qué puede molestarles o abrumarles",
        stepSubtitle: "Responda lo que pueda; los ejemplos cortos ayudan.",
        stepCompletionMessage: "Acaba de crear una guía sobre lo que puede molestar o abrumar a su ser querido.",
        promptLabel: "¿Qué lugares o cosas a su alrededor pueden resultar abrumadores?",
        question: "¿Qué lugares o cosas a su alrededor pueden resultar abrumadores?",
        examples: [
          "ruido fuerte",
          "luces brillantes",
          "lugares concurridos",
          "olores intensos",
          "demasiada gente",
          "personas demasiado cerca",
          "personas desconocidas"
        ]
      },
      mandarin: {
        sectionTitle: "什么会让他们感到不安或不堪重负",
        stepId: "upset_overwhelm",
        stepTitle: "什么会让他们感到不安或不堪重负",
        stepSubtitle: "能回答多少就回答多少，简短例子会有帮助。",
        stepCompletionMessage: "您刚刚整理出一份关于什么会让您的亲人感到不安或不堪重负的指南。",
        promptLabel: "周围哪些地方或事物会让他们觉得难以承受？",
        question: "周围哪些地方或事物会让他们觉得难以承受？",
        examples: [
          "噪音大",
          "灯光太亮",
          "人多拥挤的地方",
          "气味强烈",
          "人太多",
          "别人靠得太近",
          "不熟悉的人"
        ]
      }
    }
  },
  {
    id: "upset-overwhelm-physical-state",
    sectionId: "what_can_upset_or_overwhelm_them",
    translations: {
      english: {
        sectionTitle: "What can upset or overwhelm them",
        stepId: "upset_overwhelm",
        stepTitle: "What can upset or overwhelm them",
        stepSubtitle: "Answer what you can — short examples help.",
        stepCompletionMessage: "You just created a guide to what can upset or overwhelm your loved one.",
        promptLabel: "What things like hunger, tiredness, or not feeling well can affect them?",
        question: "What things like hunger, tiredness, or not feeling well can affect them?",
        examples: [
          "pain",
          "poor sleep",
          "medication changes"
        ]
      },
      spanish: {
        sectionTitle: "Qué puede molestarles o abrumarles",
        stepId: "upset_overwhelm",
        stepTitle: "Qué puede molestarles o abrumarles",
        stepSubtitle: "Responda lo que pueda; los ejemplos cortos ayudan.",
        stepCompletionMessage: "Acaba de crear una guía sobre lo que puede molestar o abrumar a su ser querido.",
        promptLabel: "¿Qué cosas como el hambre, el cansancio o no sentirse bien pueden afectarles?",
        question: "¿Qué cosas como el hambre, el cansancio o no sentirse bien pueden afectarles?",
        examples: [
          "dolor",
          "dormir mal",
          "cambios en la medicación"
        ]
      },
      mandarin: {
        sectionTitle: "什么会让他们感到不安或不堪重负",
        stepId: "upset_overwhelm",
        stepTitle: "什么会让他们感到不安或不堪重负",
        stepSubtitle: "能回答多少就回答多少，简短例子会有帮助。",
        stepCompletionMessage: "您刚刚整理出一份关于什么会让您的亲人感到不安或不堪重负的指南。",
        promptLabel: "像饥饿、疲惫或身体不舒服这样的情况，会怎样影响他们？",
        question: "像饥饿、疲惫或身体不舒服这样的情况，会怎样影响他们？",
        examples: [
          "疼痛",
          "睡不好",
          "药物变化"
        ]
      }
    }
  },
  {
    id: "signs-need-help-body-signs",
    sectionId: "signs_they_may_need_help",
    translations: {
      english: {
        sectionTitle: "Signs they may need help",
        stepId: "signs_need_help",
        stepTitle: "Signs they may need help",
        stepSubtitle: "Answer what you can — short examples help.",
        stepCompletionMessage: "You just created a guide to recognizing when your loved one may need help.",
        promptLabel: "What signs in their body show they need help?",
        question: "What signs in their body show they need help?",
        examples: [
          "covering ears or eyes",
          "breathing changes",
          "low energy",
          "guarding part of the body",
          "staring and not responding",
          "eye blinking or fluttering",
          "body stiffening",
          "jerking movements"
        ]
      },
      spanish: {
        sectionTitle: "Señales de que pueden necesitar ayuda",
        stepId: "signs_need_help",
        stepTitle: "Señales de que pueden necesitar ayuda",
        stepSubtitle: "Responda lo que pueda; los ejemplos cortos ayudan.",
        stepCompletionMessage: "Acaba de crear una guía para reconocer cuándo su ser querido puede necesitar ayuda.",
        promptLabel: "¿Qué señales en su cuerpo muestran que necesitan ayuda?",
        question: "¿Qué señales en su cuerpo muestran que necesitan ayuda?",
        examples: [
          "cubrirse los oídos o los ojos",
          "cambios en la respiración",
          "poca energía",
          "proteger una parte del cuerpo",
          "mirada fija sin responder",
          "parpadeo o aleteo de los ojos",
          "rigidez corporal",
          "movimientos bruscos"
        ]
      },
      mandarin: {
        sectionTitle: "他们可能需要帮助的迹象",
        stepId: "signs_need_help",
        stepTitle: "他们可能需要帮助的迹象",
        stepSubtitle: "能回答多少就回答多少，简短例子会有帮助。",
        stepCompletionMessage: "您刚刚整理出一份帮助识别您的亲人何时可能需要帮助的指南。",
        promptLabel: "他们身体上的哪些迹象说明他们需要帮助？",
        question: "他们身体上的哪些迹象说明他们需要帮助？",
        examples: [
          "捂住耳朵或眼睛",
          "呼吸变化",
          "没什么力气",
          "护着身体某个部位",
          "发呆且没有反应",
          "眨眼或眼睑快速颤动",
          "身体发僵",
          "抽动"
        ]
      }
    }
  },
  {
    id: "signs-need-help-behavior-changes",
    sectionId: "signs_they_may_need_help",
    translations: {
      english: {
        sectionTitle: "Signs they may need help",
        stepId: "signs_need_help",
        stepTitle: "Signs they may need help",
        stepSubtitle: "Answer what you can — short examples help.",
        stepCompletionMessage: "You just created a guide to recognizing when your loved one may need help.",
        promptLabel: "What changes in their behavior show they need help?",
        question: "What changes in their behavior show they need help?",
        examples: [
          "pacing",
          "yelling or becoming quieter",
          "aggression",
          "self-injury",
          "withdrawing",
          "running away",
          "repetitive movements",
          "changes in eating"
        ]
      },
      spanish: {
        sectionTitle: "Señales de que pueden necesitar ayuda",
        stepId: "signs_need_help",
        stepTitle: "Señales de que pueden necesitar ayuda",
        stepSubtitle: "Responda lo que pueda; los ejemplos cortos ayudan.",
        stepCompletionMessage: "Acaba de crear una guía para reconocer cuándo su ser querido puede necesitar ayuda.",
        promptLabel: "¿Qué cambios en su comportamiento muestran que necesitan ayuda?",
        question: "¿Qué cambios en su comportamiento muestran que necesitan ayuda?",
        examples: [
          "caminar de un lado a otro",
          "gritar o volverse más callados",
          "agresión",
          "autolesión",
          "aislarse",
          "salir corriendo",
          "movimientos repetitivos",
          "cambios en la alimentación"
        ]
      },
      mandarin: {
        sectionTitle: "他们可能需要帮助的迹象",
        stepId: "signs_need_help",
        stepTitle: "他们可能需要帮助的迹象",
        stepSubtitle: "能回答多少就回答多少，简短例子会有帮助。",
        stepCompletionMessage: "您刚刚整理出一份帮助识别您的亲人何时可能需要帮助的指南。",
        promptLabel: "他们行为上的哪些变化说明他们需要帮助？",
        question: "他们行为上的哪些变化说明他们需要帮助？",
        examples: [
          "来回踱步",
          "大喊大叫或变得更安静",
          "攻击行为",
          "自伤",
          "退缩",
          "跑开",
          "重复动作",
          "进食变化"
        ]
      }
    }
  },
  {
    id: "signs-need-help-communication-changes",
    sectionId: "signs_they_may_need_help",
    translations: {
      english: {
        sectionTitle: "Signs they may need help",
        stepId: "signs_need_help",
        stepTitle: "Signs they may need help",
        stepSubtitle: "Answer what you can — short examples help.",
        stepCompletionMessage: "You just created a guide to recognizing when your loved one may need help.",
        promptLabel: "What changes in how they communicate show they need help?",
        question: "What changes in how they communicate show they need help?",
        examples: [
          "talking less",
          "not responding",
          "repeating words or phrases",
          "unable to answer questions",
          "using behavior instead of words or communication device"
        ]
      },
      spanish: {
        sectionTitle: "Señales de que pueden necesitar ayuda",
        stepId: "signs_need_help",
        stepTitle: "Señales de que pueden necesitar ayuda",
        stepSubtitle: "Responda lo que pueda; los ejemplos cortos ayudan.",
        stepCompletionMessage: "Acaba de crear una guía para reconocer cuándo su ser querido puede necesitar ayuda.",
        promptLabel: "¿Qué cambios en cómo se comunican muestran que necesitan ayuda?",
        question: "¿Qué cambios en cómo se comunican muestran que necesitan ayuda?",
        examples: [
          "hablar menos",
          "no responder",
          "repetir palabras o frases",
          "no poder responder preguntas",
          "usar la conducta en lugar de palabras o dispositivo de comunicación"
        ]
      },
      mandarin: {
        sectionTitle: "他们可能需要帮助的迹象",
        stepId: "signs_need_help",
        stepTitle: "他们可能需要帮助的迹象",
        stepSubtitle: "能回答多少就回答多少，简短例子会有帮助。",
        stepCompletionMessage: "您刚刚整理出一份帮助识别您的亲人何时可能需要帮助的指南。",
        promptLabel: "他们沟通方式上的哪些变化说明他们需要帮助？",
        question: "他们沟通方式上的哪些变化说明他们需要帮助？",
        examples: [
          "说话变少",
          "没有回应",
          "重复词语或短语",
          "无法回答问题",
          "用行为代替语言或沟通设备"
        ]
      }
    }
  },
  {
    id: "hard-time-support-environment",
    sectionId: "what_helps_when_they_are_having_a_hard_time",
    translations: {
      english: {
        sectionTitle: "What helps when they are having a hard time",
        stepId: "hard_time_support",
        stepTitle: "What helps when they are having a hard time",
        stepSubtitle: "Answer what you can — short examples help.",
        stepCompletionMessage: "You just created a guide for how to support your loved one during difficult moments.",
        promptLabel: "What changes to the environment help?",
        question: "What changes to the environment help?",
        examples: [
          "move to a quieter space like another room, outside, or car",
          "reduce noise by turning off TV or lowering voices",
          "dim lights",
          "give space by having fewer people or moving back"
        ]
      },
      spanish: {
        sectionTitle: "Qué ayuda cuando están pasando por un momento difícil",
        stepId: "hard_time_support",
        stepTitle: "Qué ayuda cuando están pasando por un momento difícil",
        stepSubtitle: "Responda lo que pueda; los ejemplos cortos ayudan.",
        stepCompletionMessage: "Acaba de crear una guía sobre cómo apoyar a su ser querido en momentos difíciles.",
        promptLabel: "¿Qué cambios en el entorno ayudan?",
        question: "¿Qué cambios en el entorno ayudan?",
        examples: [
          "ir a un lugar más tranquilo como otra habitación, afuera o al coche",
          "reducir el ruido apagando la televisión o bajando la voz",
          "bajar las luces",
          "dar espacio haciendo que haya menos personas o alejándose un poco"
        ]
      },
      mandarin: {
        sectionTitle: "当他们状态不好时，什么会有帮助",
        stepId: "hard_time_support",
        stepTitle: "当他们状态不好时，什么会有帮助",
        stepSubtitle: "能回答多少就回答多少，简短例子会有帮助。",
        stepCompletionMessage: "您刚刚整理出一份关于如何在困难时刻支持您的亲人的指南。",
        promptLabel: "环境上做哪些调整会有帮助？",
        question: "环境上做哪些调整会有帮助？",
        examples: [
          "换到更安静的地方，比如另一个房间、室外或车里",
          "关掉电视或放低说话音量来减少噪音",
          "把灯光调暗",
          "减少周围的人或后退一些，给他们空间"
        ]
      }
    }
  },
  {
    id: "hard-time-support-calming-items",
    sectionId: "what_helps_when_they_are_having_a_hard_time",
    translations: {
      english: {
        sectionTitle: "What helps when they are having a hard time",
        stepId: "hard_time_support",
        stepTitle: "What helps when they are having a hard time",
        stepSubtitle: "Answer what you can — short examples help.",
        stepCompletionMessage: "You just created a guide for how to support your loved one during difficult moments.",
        promptLabel: "What calming items help them?",
        question: "What calming items help them?",
        examples: [
          "favorite item like a toy or comfort object",
          "headphones or music",
          "sensory tools like a fidget or weighted blanket",
          "drink or snack"
        ]
      },
      spanish: {
        sectionTitle: "Qué ayuda cuando están pasando por un momento difícil",
        stepId: "hard_time_support",
        stepTitle: "Qué ayuda cuando están pasando por un momento difícil",
        stepSubtitle: "Responda lo que pueda; los ejemplos cortos ayudan.",
        stepCompletionMessage: "Acaba de crear una guía sobre cómo apoyar a su ser querido en momentos difíciles.",
        promptLabel: "¿Qué objetos les ayudan a calmarse?",
        question: "¿Qué objetos les ayudan a calmarse?",
        examples: [
          "un objeto favorito como un juguete o algo de consuelo",
          "audífonos o música",
          "herramientas sensoriales como un juguete antiestrés o manta con peso",
          "una bebida o merienda"
        ]
      },
      mandarin: {
        sectionTitle: "当他们状态不好时，什么会有帮助",
        stepId: "hard_time_support",
        stepTitle: "当他们状态不好时，什么会有帮助",
        stepSubtitle: "能回答多少就回答多少，简短例子会有帮助。",
        stepCompletionMessage: "您刚刚整理出一份关于如何在困难时刻支持您的亲人的指南。",
        promptLabel: "哪些安抚物品会有帮助？",
        question: "哪些安抚物品会有帮助？",
        examples: [
          "喜欢的物品，比如玩具或安慰物",
          "耳机或音乐",
          "感官工具，比如指尖玩具或加重毯",
          "饮料或点心"
        ]
      }
    }
  },
  {
    id: "hard-time-support-in-the-moment",
    sectionId: "what_helps_when_they_are_having_a_hard_time",
    translations: {
      english: {
        sectionTitle: "What helps when they are having a hard time",
        stepId: "hard_time_support",
        stepTitle: "What helps when they are having a hard time",
        stepSubtitle: "Answer what you can — short examples help.",
        stepCompletionMessage: "You just created a guide for how to support your loved one during difficult moments.",
        promptLabel: "What can you do in the moment to help?",
        question: "What can you do in the moment to help?",
        examples: [
          "stay with them",
          "support communication",
          "use sensory supports like brushing",
          "take them for a car ride",
          "give a preferred treat",
          "help meet basic needs"
        ]
      },
      spanish: {
        sectionTitle: "Qué ayuda cuando están pasando por un momento difícil",
        stepId: "hard_time_support",
        stepTitle: "Qué ayuda cuando están pasando por un momento difícil",
        stepSubtitle: "Responda lo que pueda; los ejemplos cortos ayudan.",
        stepCompletionMessage: "Acaba de crear una guía sobre cómo apoyar a su ser querido en momentos difíciles.",
        promptLabel: "¿Qué puede hacer en el momento para ayudar?",
        question: "¿Qué puede hacer en el momento para ayudar?",
        examples: [
          "quedarse con ellos",
          "apoyar la comunicación",
          "usar apoyos sensoriales como el cepillado",
          "llevarlos a dar un paseo en coche",
          "darles una golosina preferida",
          "ayudar a cubrir necesidades básicas"
        ]
      },
      mandarin: {
        sectionTitle: "当他们状态不好时，什么会有帮助",
        stepId: "hard_time_support",
        stepTitle: "当他们状态不好时，什么会有帮助",
        stepSubtitle: "能回答多少就回答多少，简短例子会有帮助。",
        stepCompletionMessage: "您刚刚整理出一份关于如何在困难时刻支持您的亲人的指南。",
        promptLabel: "当下你可以做什么来帮助他们？",
        question: "当下你可以做什么来帮助他们？",
        examples: [
          "陪在他们身边",
          "帮助他们沟通",
          "使用感官支持，比如刷压",
          "带他们坐车兜风",
          "给他们喜欢的零食",
          "帮助满足基本需求"
        ]
      }
    }
  },
  {
    id: "who-to-contact-emergency",
    sectionId: "who_to_contact_and_when",
    translations: {
      english: {
        sectionTitle: "Who to contact (and when)",
        stepId: "who_to_contact",
        stepTitle: "Who to contact (and when)",
        stepSubtitle: "Answer what you can — short examples help.",
        stepCompletionMessage: "You just created a contact guide for your loved one.",
        promptLabel: "Who should be contacted in an emergency?",
        question: "Who should be contacted in an emergency?",
        examples: [
          "911",
          "parent/guardian",
          "doctor"
        ]
      },
      spanish: {
        sectionTitle: "A quién contactar (y cuándo)",
        stepId: "who_to_contact",
        stepTitle: "A quién contactar (y cuándo)",
        stepSubtitle: "Responda lo que pueda; los ejemplos cortos ayudan.",
        stepCompletionMessage: "Acaba de crear una guía de contactos para su ser querido.",
        promptLabel: "¿A quién se debe contactar en una emergencia?",
        question: "¿A quién se debe contactar en una emergencia?",
        examples: [
          "911",
          "madre, padre o tutor",
          "médico"
        ]
      },
      mandarin: {
        sectionTitle: "联系谁（以及何时联系）",
        stepId: "who_to_contact",
        stepTitle: "联系谁（以及何时联系）",
        stepSubtitle: "能回答多少就回答多少，简短例子会有帮助。",
        stepCompletionMessage: "您刚刚为您的亲人创建了一份联系指南。",
        promptLabel: "紧急情况下应该联系谁？",
        question: "紧急情况下应该联系谁？",
        examples: [
          "911",
          "父母或监护人",
          "医生"
        ]
      }
    }
  },
  {
    id: "who-to-contact-non-emergency",
    sectionId: "who_to_contact_and_when",
    translations: {
      english: {
        sectionTitle: "Who to contact (and when)",
        stepId: "who_to_contact",
        stepTitle: "Who to contact (and when)",
        stepSubtitle: "Answer what you can — short examples help.",
        stepCompletionMessage: "You just created a contact guide for your loved one.",
        promptLabel: "Who should be contacted in non-emergencies?",
        question: "Who should be contacted in non-emergencies?",
        examples: [
          "seizures",
          "medication questions",
          "unsafe behavior",
          "running away",
          "crisis support"
        ]
      },
      spanish: {
        sectionTitle: "A quién contactar (y cuándo)",
        stepId: "who_to_contact",
        stepTitle: "A quién contactar (y cuándo)",
        stepSubtitle: "Responda lo que pueda; los ejemplos cortos ayudan.",
        stepCompletionMessage: "Acaba de crear una guía de contactos para su ser querido.",
        promptLabel: "¿A quién se debe contactar en situaciones que no son emergencias?",
        question: "¿A quién se debe contactar en situaciones que no son emergencias?",
        examples: [
          "convulsiones",
          "preguntas sobre medicamentos",
          "conducta insegura",
          "salir corriendo",
          "apoyo en crisis"
        ]
      },
      mandarin: {
        sectionTitle: "联系谁（以及何时联系）",
        stepId: "who_to_contact",
        stepTitle: "联系谁（以及何时联系）",
        stepSubtitle: "能回答多少就回答多少，简短例子会有帮助。",
        stepCompletionMessage: "您刚刚为您的亲人创建了一份联系指南。",
        promptLabel: "非紧急情况下应该联系谁？",
        question: "非紧急情况下应该联系谁？",
        examples: [
          "癫痫发作",
          "药物问题",
          "不安全行为",
          "跑开",
          "危机支持"
        ]
      }
    }
  },
  {
    id: "who-to-contact-call-guidance",
    sectionId: "who_to_contact_and_when",
    translations: {
      english: {
        sectionTitle: "Who to contact (and when)",
        stepId: "who_to_contact",
        stepTitle: "Who to contact (and when)",
        stepSubtitle: "Answer what you can — short examples help.",
        stepCompletionMessage: "You just created a contact guide for your loved one.",
        promptLabel: "Is there anything important others should know about when to call or not call?",
        question: "Is there anything important others should know about when to call or not call?",
        examples: [
          "when to wait",
          "when to call right away",
          "who to contact first"
        ]
      },
      spanish: {
        sectionTitle: "A quién contactar (y cuándo)",
        stepId: "who_to_contact",
        stepTitle: "A quién contactar (y cuándo)",
        stepSubtitle: "Responda lo que pueda; los ejemplos cortos ayudan.",
        stepCompletionMessage: "Acaba de crear una guía de contactos para su ser querido.",
        promptLabel: "¿Hay algo importante que otras personas deban saber sobre cuándo llamar o no llamar?",
        question: "¿Hay algo importante que otras personas deban saber sobre cuándo llamar o no llamar?",
        examples: [
          "cuándo esperar",
          "cuándo llamar de inmediato",
          "a quién contactar primero"
        ]
      },
      mandarin: {
        sectionTitle: "联系谁（以及何时联系）",
        stepId: "who_to_contact",
        stepTitle: "联系谁（以及何时联系）",
        stepSubtitle: "能回答多少就回答多少，简短例子会有帮助。",
        stepCompletionMessage: "您刚刚为您的亲人创建了一份联系指南。",
        promptLabel: "关于什么时候该打电话、什么时候先不要打电话，还有什么重要信息需要别人知道吗？",
        question: "关于什么时候该打电话、什么时候先不要打电话，还有什么重要信息需要别人知道吗？",
        examples: [
          "什么时候可以先等一等",
          "什么时候要马上打电话",
          "应该先联系谁"
        ]
      }
    }
  }
];

export function getLanguageLabel(language: UiLanguage, displayLanguage: UiLanguage) {
  return languageLabels[displayLanguage][language];
}

export function getWelcomeCopy(language: UiLanguage) {
  return welcomeCopy[language];
}

export function getReflectionCopy(language: UiLanguage) {
  return reflectionCopy[language];
}

export function getReviewCopy(language: UiLanguage) {
  return reviewCopy[language];
}

export function getCompletionCopy(language: UiLanguage) {
  return completionCopy[language];
}

export function getResetPasswordCopy(language: UiLanguage) {
  return resetPasswordCopy[language];
}

export function getLocalizedReflectionPrompts(language: UiLanguage): ReflectionPrompt[] {
  return promptDefinitions.map((prompt) => ({
    id: prompt.id,
    sectionId: prompt.sectionId,
    ...prompt.translations[language]
  }));
}
