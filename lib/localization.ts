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
  addSectionButton: string;
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
        ? "45-second limit reached. Transcribing now and retrying automatically if Gemini is busy..."
        : `45-second limit reached. Translating ${languageLabel} speech into English now and retrying automatically if Gemini is busy...`,
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
        ? "Se alcanzó el límite de 45 segundos. Se transcribirá ahora y se volverá a intentar automáticamente si Gemini está ocupado..."
        : `Se alcanzó el límite de 45 segundos. La voz en ${languageLabel} se traducirá al inglés ahora y se volverá a intentar automáticamente si Gemini está ocupado...`,
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
        ? "已达到 45 秒上限。现在开始转录；如果 Gemini 正忙，系统会自动重试。"
        : `已达到 45 秒上限。现在开始把${languageLabel}语音翻译成英文；如果 Gemini 正忙，系统会自动重试。`,
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
    addSectionButton: "Add section",
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
    addSectionButton: "Agregar sección",
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
    addSectionButton: "新增部分",
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
          "words, sounds, gestures, pointing, or leading you",
          "pictures, communication device, or writing"
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
          "palabras, sonidos, gestos, señalar o llevarle hacia algo",
          "imágenes, un dispositivo de comunicación o escritura",
          "cualquier cosa que otra persona cuidadora notará enseguida"
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
          "词语、声音、手势、指东西，或带你去某处",
          "图片、沟通设备，或书写",
          "任何其他照护者一开始就会注意到的方式"
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
          "llevarle hacia algo significa que quiere algo",
          "sentarse muy cerca significa que quiere atención",
          "repetir una frase puede significar ansiedad o emoción"
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
          "带你过去表示他们想要某样东西",
          "坐得很近表示他们想要关注",
          "重复一句话可能表示焦虑或兴奋"
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
          "not responding -> check device, environment, or whether they can find what they need"
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
          "si no responden, revise primero el dispositivo o el entorno",
          "puede que no encuentren lo que necesitan"
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
          "没有回应时，先检查设备或环境",
          "他们可能找不到自己需要的东西"
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
        promptLabel: "¿Qué información de salud o médica debería saber otra persona cuidadora de inmediato?",
        question: "¿Qué información de salud o médica debería saber otra persona cuidadora de inmediato?",
        examples: [
          "alergias, diagnósticos, convulsiones, asma o problemas gastrointestinales",
          "cualquier cosa urgente o fácil de pasar por alto",
          "lo que otra persona cuidadora debería saber antes de empezar el día"
        ]
      },
      mandarin: {
        sectionTitle: "什么有助于让一天顺利进行",
        stepId: "health_safety",
        stepTitle: "健康与安全",
        stepSubtitle: "能回答多少就回答多少，简短例子会有帮助。",
        stepCompletionMessage: "您刚刚为您的亲人创建了一份健康与安全指南。",
        promptLabel: "其他照护者一开始就应该知道哪些健康或医疗信息？",
        question: "其他照护者一开始就应该知道哪些健康或医疗信息？",
        examples: [
          "过敏、诊断、癫痫、哮喘或胃肠问题",
          "任何紧急或容易忽略的情况",
          "其他照护者开始照护前需要知道的内容"
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
        promptLabel: "¿Qué medicamentos, tratamientos o rutinas de salud deben hacerse correctamente?",
        question: "¿Qué medicamentos, tratamientos o rutinas de salud deben hacerse correctamente?",
        examples: [
          "horarios de medicamentos o cómo se administran",
          "qué debe suceder antes o después de las comidas",
          "qué no se debe omitir"
        ]
      },
      mandarin: {
        sectionTitle: "什么有助于让一天顺利进行",
        stepId: "health_safety",
        stepTitle: "健康与安全",
        stepSubtitle: "能回答多少就回答多少，简短例子会有帮助。",
        stepCompletionMessage: "您刚刚为您的亲人创建了一份健康与安全指南。",
        promptLabel: "哪些药物、治疗或健康相关流程必须正确完成？",
        question: "哪些药物、治疗或健康相关流程必须正确完成？",
        examples: [
          "用药时间或服用方式",
          "饭前或饭后需要做什么",
          "哪些事情绝不能漏掉"
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
        promptLabel: "¿Qué equipo, dispositivos o apoyos físicos usan?",
        question: "¿Qué equipo, dispositivos o apoyos físicos usan?",
        examples: [
          "gafas, audífonos, silla de ruedas, cinturón de marcha o equipo de alimentación",
          "lo que les ayuda a moverse, comer, oír o mantenerse seguros",
          "cualquier cosa que otra persona cuidadora deba revisar o preparar"
        ]
      },
      mandarin: {
        sectionTitle: "什么有助于让一天顺利进行",
        stepId: "health_safety",
        stepTitle: "健康与安全",
        stepSubtitle: "能回答多少就回答多少，简短例子会有帮助。",
        stepCompletionMessage: "您刚刚为您的亲人创建了一份健康与安全指南。",
        promptLabel: "他们会使用哪些设备、器具或身体支持工具？",
        question: "他们会使用哪些设备、器具或身体支持工具？",
        examples: [
          "眼镜、助听器、轮椅、步行带或喂食设备",
          "帮助他们移动、进食、听清或保持安全的工具",
          "照护者需要检查或准备的任何东西"
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
        promptLabel: "¿Qué preocupaciones de seguridad debería tener presentes otra persona cuidadora?",
        question: "¿Qué preocupaciones de seguridad debería tener presentes otra persona cuidadora?",
        examples: [
          "riesgo de caídas, atragantamiento, escaparse o necesitar dos adultos en salidas",
          "conductas inseguras a las que haya que prestar atención",
          "lo que otra persona cuidadora nunca debería asumir que es seguro"
        ]
      },
      mandarin: {
        sectionTitle: "什么有助于让一天顺利进行",
        stepId: "health_safety",
        stepTitle: "健康与安全",
        stepSubtitle: "能回答多少就回答多少，简短例子会有帮助。",
        stepCompletionMessage: "您刚刚为您的亲人创建了一份健康与安全指南。",
        promptLabel: "其他照护者需要特别注意哪些安全问题？",
        question: "其他照护者需要特别注意哪些安全问题？",
        examples: [
          "跌倒、呛咳、走失，或外出时需要两位成人陪同",
          "需要留意的不安全行为",
          "其他照护者绝不能想当然地认为安全的事情"
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
        stepTitle: "Daily schedule",
        stepSubtitle: "Answer what you can — short examples help.",
        stepCompletionMessage: "You just created a daily schedule guide for your loved one.",
        promptLabel: "What helps mornings go smoothly?",
        question: "What helps mornings go smoothly?",
        examples: [
          "bathroom first, breakfast before medication, or brushing teeth after eating",
          "what order works best",
          "what usually throws the morning off"
        ]
      },
      spanish: {
        sectionTitle: "Lo que ayuda a que el día vaya bien",
        stepId: "daily_schedule",
        stepTitle: "Rutina diaria",
        stepSubtitle: "Responda lo que pueda; los ejemplos cortos ayudan.",
        stepCompletionMessage: "Acaba de crear una guía de rutina diaria para su ser querido.",
        promptLabel: "¿Qué ayuda a que las mañanas transcurran bien?",
        question: "¿Qué ayuda a que las mañanas transcurran bien?",
        examples: [
          "ir al baño primero, desayunar antes del medicamento, o lavarse los dientes después de comer",
          "qué orden funciona mejor",
          "qué suele desordenar la mañana"
        ]
      },
      mandarin: {
        sectionTitle: "什么有助于让一天顺利进行",
        stepId: "daily_schedule",
        stepTitle: "日常安排",
        stepSubtitle: "能回答多少就回答多少，简短例子会有帮助。",
        stepCompletionMessage: "您刚刚为您的亲人创建了一份日常安排指南。",
        promptLabel: "什么能让早晨更顺利？",
        question: "什么能让早晨更顺利？",
        examples: [
          "先上厕所、先吃早餐再吃药，或饭后刷牙",
          "什么顺序最有效",
          "什么事情通常会打乱早晨安排"
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
        stepTitle: "Daily schedule",
        stepSubtitle: "Answer what you can — short examples help.",
        stepCompletionMessage: "You just created a daily schedule guide for your loved one.",
        promptLabel: "What should another caregiver know about meals and snacks?",
        question: "What should another caregiver know about meals and snacks?",
        examples: [
          "preferred foods, timing, or foods to avoid",
          "how to tell when they are hungry",
          "what helps meals go more smoothly"
        ]
      },
      spanish: {
        sectionTitle: "Lo que ayuda a que el día vaya bien",
        stepId: "daily_schedule",
        stepTitle: "Rutina diaria",
        stepSubtitle: "Responda lo que pueda; los ejemplos cortos ayudan.",
        stepCompletionMessage: "Acaba de crear una guía de rutina diaria para su ser querido.",
        promptLabel: "¿Qué debería saber otra persona cuidadora sobre las comidas y meriendas?",
        question: "¿Qué debería saber otra persona cuidadora sobre las comidas y meriendas?",
        examples: [
          "comidas preferidas, horarios o alimentos que conviene evitar",
          "cómo notar que tiene hambre",
          "qué ayuda a que las comidas sean más fluidas"
        ]
      },
      mandarin: {
        sectionTitle: "什么有助于让一天顺利进行",
        stepId: "daily_schedule",
        stepTitle: "日常安排",
        stepSubtitle: "能回答多少就回答多少，简短例子会有帮助。",
        stepCompletionMessage: "您刚刚为您的亲人创建了一份日常安排指南。",
        promptLabel: "关于正餐和点心，其他照护者应该知道什么？",
        question: "关于正餐和点心，其他照护者应该知道什么？",
        examples: [
          "喜欢的食物、时间安排，或需要避免的食物",
          "如何判断他们饿了",
          "什么能让吃饭更顺利"
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
        stepTitle: "Daily schedule",
        stepSubtitle: "Answer what you can — short examples help.",
        stepCompletionMessage: "You just created a daily schedule guide for your loved one.",
        promptLabel: "What helps with transitions during the day?",
        question: "What helps with transitions during the day?",
        examples: [
          "countdowns, five more minutes, or visual schedules",
          "moving slowly from one activity to the next",
          "what makes transitions harder"
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
          "cuenta regresiva, cinco minutos más, u horarios visuales",
          "pasar poco a poco de una actividad a otra",
          "qué hace que las transiciones sean más difíciles"
        ]
      },
      mandarin: {
        sectionTitle: "什么有助于让一天顺利进行",
        stepId: "daily_schedule",
        stepTitle: "日常安排",
        stepSubtitle: "能回答多少就回答多少，简短例子会有帮助。",
        stepCompletionMessage: "您刚刚为您的亲人创建了一份日常安排指南。",
        promptLabel: "白天活动切换时，什么方式会有帮助？",
        question: "白天活动切换时，什么方式会有帮助？",
        examples: [
          "倒计时、再五分钟，或视觉日程表",
          "从一个活动慢慢过渡到下一个活动",
          "什么会让转换更困难"
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
        stepTitle: "Daily schedule",
        stepSubtitle: "Answer what you can — short examples help.",
        stepCompletionMessage: "You just created a daily schedule guide for your loved one.",
        promptLabel: "What helps evenings or bedtime go smoothly?",
        question: "What helps evenings or bedtime go smoothly?",
        examples: [
          "bath, pajamas, a show, music, or a set bedtime routine",
          "what helps them wind down",
          "what to avoid late in the day"
        ]
      },
      spanish: {
        sectionTitle: "Lo que ayuda a que el día vaya bien",
        stepId: "daily_schedule",
        stepTitle: "Rutina diaria",
        stepSubtitle: "Responda lo que pueda; los ejemplos cortos ayudan.",
        stepCompletionMessage: "Acaba de crear una guía de rutina diaria para su ser querido.",
        promptLabel: "¿Qué ayuda a que la tarde o la hora de dormir transcurran bien?",
        question: "¿Qué ayuda a que la tarde o la hora de dormir transcurran bien?",
        examples: [
          "baño, pijama, un programa, música o una rutina fija para dormir",
          "qué les ayuda a relajarse",
          "qué conviene evitar al final del día"
        ]
      },
      mandarin: {
        sectionTitle: "什么有助于让一天顺利进行",
        stepId: "daily_schedule",
        stepTitle: "日常安排",
        stepSubtitle: "能回答多少就回答多少，简短例子会有帮助。",
        stepCompletionMessage: "您刚刚为您的亲人创建了一份日常安排指南。",
        promptLabel: "什么能让傍晚或睡前更顺利？",
        question: "什么能让傍晚或睡前更顺利？",
        examples: [
          "洗澡、换睡衣、看节目、听音乐，或固定的睡前流程",
          "什么能帮助他们平静下来",
          "一天后半段最好避免什么"
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
        stepTitle: "Activities & preferences",
        stepSubtitle: "Answer what you can — short examples help.",
        stepCompletionMessage: "You just created an activities and preferences guide for your loved one.",
        promptLabel: "What activities do they enjoy most?",
        question: "What activities do they enjoy most?",
        examples: [
          "music, videos, crafts, games, sports, walks, or iPad time",
          "what usually keeps them engaged",
          "what they ask for again and again"
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
          "música, videos, manualidades, juegos, deportes, caminatas o tiempo con la tableta",
          "qué suele mantenerles interesados",
          "qué piden una y otra vez"
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
          "音乐、视频、手工、游戏、运动、散步或平板时间",
          "什么通常能让他们投入其中",
          "他们会一再要求的活动"
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
        stepTitle: "Activities & preferences",
        stepSubtitle: "Answer what you can — short examples help.",
        stepCompletionMessage: "You just created an activities and preferences guide for your loved one.",
        promptLabel: "What outings, places, or routines outside the home usually go well?",
        question: "What outings, places, or routines outside the home usually go well?",
        examples: [
          "favorite stores, drives, parks, or familiar places",
          "what makes an outing feel successful",
          "what kind of outing usually helps the day"
        ]
      },
      spanish: {
        sectionTitle: "Lo que ayuda a que el día vaya bien",
        stepId: "activities_preferences",
        stepTitle: "Actividades y preferencias",
        stepSubtitle: "Responda lo que pueda; los ejemplos cortos ayudan.",
        stepCompletionMessage: "Acaba de crear una guía de actividades y preferencias para su ser querido.",
        promptLabel: "¿Qué salidas, lugares o rutinas fuera de casa suelen salir bien?",
        question: "¿Qué salidas, lugares o rutinas fuera de casa suelen salir bien?",
        examples: [
          "tiendas favoritas, paseos en coche, parques o lugares conocidos",
          "qué hace que una salida funcione bien",
          "qué tipo de salida suele ayudar al día"
        ]
      },
      mandarin: {
        sectionTitle: "什么有助于让一天顺利进行",
        stepId: "activities_preferences",
        stepTitle: "活动与偏好",
        stepSubtitle: "能回答多少就回答多少，简短例子会有帮助。",
        stepCompletionMessage: "您刚刚为您的亲人创建了一份活动与偏好指南。",
        promptLabel: "外出时，哪些地方、活动或固定安排通常会比较顺利？",
        question: "外出时，哪些地方、活动或固定安排通常会比较顺利？",
        examples: [
          "喜欢的商店、兜风、公园，或熟悉的地点",
          "什么会让一次外出更成功",
          "哪类外出通常有助于让一天更顺利"
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
        stepTitle: "Activities & preferences",
        stepSubtitle: "Answer what you can — short examples help.",
        stepCompletionMessage: "You just created an activities and preferences guide for your loved one.",
        promptLabel: "Who do they usually do well with?",
        question: "Who do they usually do well with?",
        examples: [
          "family members, siblings, specific caregivers, or friends",
          "what those people tend to do well",
          "who helps them feel safe or calm"
        ]
      },
      spanish: {
        sectionTitle: "Lo que ayuda a que el día vaya bien",
        stepId: "activities_preferences",
        stepTitle: "Actividades y preferencias",
        stepSubtitle: "Responda lo que pueda; los ejemplos cortos ayudan.",
        stepCompletionMessage: "Acaba de crear una guía de actividades y preferencias para su ser querido.",
        promptLabel: "¿Con quién suelen estar bien?",
        question: "¿Con quién suelen estar bien?",
        examples: [
          "familiares, hermanos, cuidadores específicos o amistades",
          "qué hacen bien esas personas",
          "quién les ayuda a sentirse seguros o tranquilos"
        ]
      },
      mandarin: {
        sectionTitle: "什么有助于让一天顺利进行",
        stepId: "activities_preferences",
        stepTitle: "活动与偏好",
        stepSubtitle: "能回答多少就回答多少，简短例子会有帮助。",
        stepCompletionMessage: "您刚刚为您的亲人创建了一份活动与偏好指南。",
        promptLabel: "他们通常和哪些人在一起会比较顺利？",
        question: "他们通常和哪些人在一起会比较顺利？",
        examples: [
          "家人、兄弟姐妹、特定照护者，或朋友",
          "这些人通常做对了什么",
          "谁能帮助他们感到安全或平静"
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
        stepTitle: "Activities & preferences",
        stepSubtitle: "Answer what you can — short examples help.",
        stepCompletionMessage: "You just created an activities and preferences guide for your loved one.",
        promptLabel: "What kind of quiet time or sensory environment helps?",
        question: "What kind of quiet time or sensory environment helps?",
        examples: [
          "low light, music, headphones, rest time, or a sensory space",
          "what helps them reset",
          "what kind of environment usually feels calming"
        ]
      },
      spanish: {
        sectionTitle: "Lo que ayuda a que el día vaya bien",
        stepId: "activities_preferences",
        stepTitle: "Actividades y preferencias",
        stepSubtitle: "Responda lo que pueda; los ejemplos cortos ayudan.",
        stepCompletionMessage: "Acaba de crear una guía de actividades y preferencias para su ser querido.",
        promptLabel: "¿Qué tipo de tiempo tranquilo o ambiente sensorial ayuda?",
        question: "¿Qué tipo de tiempo tranquilo o ambiente sensorial ayuda?",
        examples: [
          "poca luz, música, audífonos, descanso o un espacio sensorial",
          "qué les ayuda a reiniciarse",
          "qué tipo de ambiente suele ser calmante"
        ]
      },
      mandarin: {
        sectionTitle: "什么有助于让一天顺利进行",
        stepId: "activities_preferences",
        stepTitle: "活动与偏好",
        stepSubtitle: "能回答多少就回答多少，简短例子会有帮助。",
        stepCompletionMessage: "您刚刚为您的亲人创建了一份活动与偏好指南。",
        promptLabel: "什么样的安静时间或感官环境会有帮助？",
        question: "什么样的安静时间或感官环境会有帮助？",
        examples: [
          "低光、音乐、耳机、休息时间，或感官空间",
          "什么能帮助他们重新调整状态",
          "什么样的环境通常最让人平静"
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
