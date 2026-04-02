import { ReflectionPrompt, StructuredSummary, UiLanguage } from "@/lib/types";

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
  signedInAs: (email: string) => string;
  signOutButton: string;
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

type ReflectionCopy = {
  title: string;
  subtitle: string;
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

type SummaryFieldLabels = Record<keyof StructuredSummary, string>;

type ReviewCopy = {
  title: string;
  subtitle: string;
  saveButton: string;
  savingButton: string;
  saveFailed: string;
  confirmFailed: string;
  fieldLabels: SummaryFieldLabels;
};

type CompletionCopy = {
  emptyTitle: string;
  emptySubtitle: string;
  emptyMessage: string;
  title: string;
  subtitle: string;
  downloadPdfButton: string;
  feedbackLabel: string;
  feedbackPlaceholder: string;
  commentsLabel: string;
  saveFeedbackButton: string;
  feedbackSaved: string;
  feedbackSaveFailed: string;
  fieldLabels: SummaryFieldLabels;
};

type PromptTranslation = {
  sectionTitle: string;
  promptLabel: string;
  question: string;
  examples: string[];
};

const welcomeCopy: Record<UiLanguage, WelcomeCopy> = {
  english: {
    title: "This will take about 5 minutes.",
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
    signedInAs: (email) => `Signed in as ${email}`,
    signOutButton: "Sign out",
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
    theirPreferredName: "What name do they like to be called? (optional)",
    theirDateOfBirth: "Date of birth (optional)",
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
    title: "Esto tomará unos 5 minutos.",
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
    signedInAs: (email) => `Sesión iniciada como ${email}`,
    signOutButton: "Cerrar sesión",
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
    theirPreferredName: "¿Cómo le gusta que le llamen? (opcional)",
    theirDateOfBirth: "Fecha de nacimiento (opcional)",
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
    title: "大约需要 5 分钟完成。",
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
    signedInAs: (email) => `当前登录邮箱：${email}`,
    signOutButton: "退出登录",
    aboutYou: "关于您",
    aboutYouSubtitle: "（方便我们为您个性化调整）",
    yourFirstName: "名字",
    yourLastName: "姓氏",
    caregiver55OrOlder: "您是否年满 55 岁？（这有助于我们了解项目中年长照护者的经历）",
    aboutSupportedPerson: "关于您照护的人",
    aboutSupportedPersonSubtitle: "（让其他人知道他们正在支持谁）",
    theirFirstName: "名字",
    theirLastName: "姓氏",
    theirPreferredName: "他们喜欢别人怎么称呼？（可选）",
    theirDateOfBirth: "出生日期（可选）",
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
    title: "Guided reflection",
    subtitle:
      "Start by capturing what helps the day go well. Each prompt covers one subsection, and you can skip anything that does not matter.",
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
    audioNotSupported: "Audio recording is not supported here.",
    noSpeechDetected: "No speech was detected. You can try again or type your response.",
    recordingTooShort: "Recording was too short. Try again or type your response.",
    recordingTooLarge: "That recording is too long to upload. Try a shorter recording or type the rest.",
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
        ? "Recording limit reached. Transcribing now and retrying automatically if Gemini is busy..."
        : `Recording limit reached. Translating ${languageLabel} speech into English now and retrying automatically if Gemini is busy...`,
    recordingStatus: (current, max) => `Recording ${current} of ${max}.`
  },
  spanish: {
    title: "Reflexión guiada",
    subtitle:
      "Empiece por describir lo que ayuda a que el día vaya bien. Cada pregunta cubre una parte distinta y puede omitir lo que no sea importante.",
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
    audioNotSupported: "La grabación de audio no está disponible aquí.",
    noSpeechDetected: "No se detectó voz. Puede intentarlo de nuevo o escribir su respuesta.",
    recordingTooShort: "La grabación fue demasiado corta. Inténtelo de nuevo o escriba su respuesta.",
    recordingTooLarge:
      "La grabación es demasiado larga para subirse. Inténtelo con una grabación más corta o escriba el resto.",
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
        ? "Se alcanzó el límite de grabación. Se transcribirá ahora y se volverá a intentar automáticamente si Gemini está ocupado..."
        : `Se alcanzó el límite de grabación. La voz en ${languageLabel} se traducirá al inglés ahora y se volverá a intentar automáticamente si Gemini está ocupado...`,
    recordingStatus: (current, max) => `Grabando ${current} de ${max}.`
  },
  mandarin: {
    title: "引导式填写",
    subtitle: "先说明哪些做法能让一天更顺利。每个问题只关注一个小主题，不重要的内容可以跳过。",
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
    audioNotSupported: "此处不支持录音。",
    noSpeechDetected: "未检测到语音。您可以再试一次，或直接输入回答。",
    recordingTooShort: "录音时间太短。请重试，或直接输入回答。",
    recordingTooLarge: "这段录音太长，无法上传。请缩短录音，或把剩余内容直接输入。",
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
        ? "已达到录音上限。现在开始转录；如果 Gemini 正忙，系统会自动重试。"
        : `已达到录音上限。现在开始把${languageLabel}语音翻译成英文；如果 Gemini 正忙，系统会自动重试。`,
    recordingStatus: (current, max) => `正在录音 ${current} / ${max}。`
  }
};

const summaryFieldLabels: Record<UiLanguage, SummaryFieldLabels> = {
  english: {
    key_barriers: "Key barriers",
    emotional_concerns: "Emotional concerns",
    safety_considerations: "Safety considerations",
    past_negative_experiences: "Past negative experiences",
    situations_to_avoid: "Situations to avoid",
    conditions_for_successful_respite: "Conditions for successful respite",
    unresolved_questions: "Unresolved questions",
    caregiver_summary_text: "Synthesized caregiver summary"
  },
  spanish: {
    key_barriers: "Barreras principales",
    emotional_concerns: "Preocupaciones emocionales",
    safety_considerations: "Consideraciones de seguridad",
    past_negative_experiences: "Experiencias negativas previas",
    situations_to_avoid: "Situaciones que conviene evitar",
    conditions_for_successful_respite: "Condiciones para un relevo exitoso",
    unresolved_questions: "Preguntas pendientes",
    caregiver_summary_text: "Resumen sintetizado para la persona cuidadora"
  },
  mandarin: {
    key_barriers: "主要障碍",
    emotional_concerns: "情绪方面的担忧",
    safety_considerations: "安全注意事项",
    past_negative_experiences: "过去的不良经历",
    situations_to_avoid: "需要避免的情况",
    conditions_for_successful_respite: "顺利交接所需条件",
    unresolved_questions: "尚未解决的问题",
    caregiver_summary_text: "综合照护摘要"
  }
};

const reviewCopy: Record<UiLanguage, ReviewCopy> = {
  english: {
    title: "Review and edit",
    subtitle:
      "Review the AI-structured summary below. You can edit any section before saving the final version.",
    saveButton: "Confirm and save",
    savingButton: "Saving...",
    saveFailed: "Save failed.",
    confirmFailed: "Unable to save the confirmed summary.",
    fieldLabels: summaryFieldLabels.english
  },
  spanish: {
    title: "Revisar y editar",
    subtitle:
      "Revise el resumen estructurado por IA a continuación. Puede editar cualquier sección antes de guardar la versión final.",
    saveButton: "Confirmar y guardar",
    savingButton: "Guardando...",
    saveFailed: "No fue posible guardar.",
    confirmFailed: "No fue posible guardar el resumen confirmado.",
    fieldLabels: summaryFieldLabels.spanish
  },
  mandarin: {
    title: "审核并编辑",
    subtitle: "请先查看下方的 AI 结构化摘要。保存最终版本前，您可以编辑任何部分。",
    saveButton: "确认并保存",
    savingButton: "正在保存...",
    saveFailed: "保存失败。",
    confirmFailed: "无法保存已确认的摘要。",
    fieldLabels: summaryFieldLabels.mandarin
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
    downloadPdfButton: "Download as PDF",
    feedbackLabel: "How useful was this?",
    feedbackPlaceholder: "For example: very useful, somewhat useful, not useful",
    commentsLabel: "Comments",
    saveFeedbackButton: "Save feedback",
    feedbackSaved: "Feedback saved.",
    feedbackSaveFailed: "Unable to save feedback right now.",
    fieldLabels: summaryFieldLabels.english
  },
  spanish: {
    emptyTitle: "Finalización",
    emptySubtitle: "El resumen guardado aparecerá aquí después de la confirmación.",
    emptyMessage: "Todavía no hay un resumen guardado.",
    title: "Resumen guardado",
    subtitle:
      "Aquí verá el resumen final editado, podrá exportarlo como PDF desde el navegador y dejar comentarios breves.",
    downloadPdfButton: "Descargar como PDF",
    feedbackLabel: "¿Qué tan útil fue esto?",
    feedbackPlaceholder: "Por ejemplo: muy útil, algo útil, poco útil",
    commentsLabel: "Comentarios",
    saveFeedbackButton: "Guardar comentarios",
    feedbackSaved: "Comentarios guardados.",
    feedbackSaveFailed: "No fue posible guardar los comentarios en este momento.",
    fieldLabels: summaryFieldLabels.spanish
  },
  mandarin: {
    emptyTitle: "完成",
    emptySubtitle: "确认后，已保存的摘要会显示在这里。",
    emptyMessage: "目前还没有已保存的摘要。",
    title: "摘要已保存",
    subtitle: "这里会显示最终编辑后的摘要，您也可以导出 PDF，并留下简短反馈。",
    downloadPdfButton: "下载 PDF",
    feedbackLabel: "这份内容对您有多大帮助？",
    feedbackPlaceholder: "例如：非常有帮助、有些帮助、没有帮助",
    commentsLabel: "意见",
    saveFeedbackButton: "保存反馈",
    feedbackSaved: "反馈已保存。",
    feedbackSaveFailed: "暂时无法保存反馈。",
    fieldLabels: summaryFieldLabels.mandarin
  }
};

const promptDefinitions: Array<{
  id: string;
  sectionId: ReflectionPrompt["sectionId"];
  translations: Record<UiLanguage, PromptTranslation>;
}> = [
  {
    id: "day-goes-well-communication",
    sectionId: "what_helps_the_day_go_well",
    translations: {
      english: {
        sectionTitle: "What helps the day go well",
        promptLabel: "Communication",
        question:
          "What should another caregiver know about communication so the day goes more smoothly?",
        examples: [
          "gestures, words, sounds, or a communication device",
          "whether they need extra time to respond",
          "anything that helps them understand or express needs"
        ]
      },
      spanish: {
        sectionTitle: "Lo que ayuda a que el día vaya bien",
        promptLabel: "Comunicación",
        question:
          "¿Qué debería saber otra persona cuidadora sobre la comunicación para que el día transcurra con más facilidad?",
        examples: [
          "gestos, palabras, sonidos o un dispositivo de comunicación",
          "si necesita más tiempo para responder",
          "cualquier cosa que le ayude a entender o expresar necesidades"
        ]
      },
      mandarin: {
        sectionTitle: "什么有助于让一天顺利进行",
        promptLabel: "沟通",
        question: "为了让一天更顺利，其他照护者需要了解哪些沟通方式？",
        examples: [
          "手势、词语、声音，或沟通设备",
          "是否需要更多时间来回应",
          "任何有助于理解或表达需求的方式"
        ]
      }
    }
  },
  {
    id: "day-goes-well-health-safety",
    sectionId: "what_helps_the_day_go_well",
    translations: {
      english: {
        sectionTitle: "What helps the day go well",
        promptLabel: "Health & safety",
        question: "What health or safety information matters most for another caregiver to know?",
        examples: [
          "allergies, medical conditions, or medications",
          "equipment such as hearing aids, glasses, wheelchair, or feeding tube",
          "anything another caregiver must do correctly to keep them safe"
        ]
      },
      spanish: {
        sectionTitle: "Lo que ayuda a que el día vaya bien",
        promptLabel: "Salud y seguridad",
        question:
          "¿Qué información de salud o seguridad es más importante que otra persona cuidadora sepa?",
        examples: [
          "alergias, condiciones médicas o medicamentos",
          "equipo como audífonos, gafas, silla de ruedas o sonda de alimentación",
          "cualquier cosa que otra persona cuidadora deba hacer correctamente para mantenerle a salvo"
        ]
      },
      mandarin: {
        sectionTitle: "什么有助于让一天顺利进行",
        promptLabel: "健康与安全",
        question: "有哪些健康或安全信息是其他照护者最需要知道的？",
        examples: [
          "过敏、医疗状况或药物",
          "助听器、眼镜、轮椅或喂食管等设备",
          "任何必须正确执行才能确保安全的事情"
        ]
      }
    }
  },
  {
    id: "day-goes-well-daily-schedule",
    sectionId: "what_helps_the_day_go_well",
    translations: {
      english: {
        sectionTitle: "What helps the day go well",
        promptLabel: "Daily schedule",
        question: "What routines, transitions, meals, or daily activities help the day stay on track?",
        examples: [
          "morning or bedtime routines",
          "meal and snack timing",
          "transition supports like countdowns or visual schedules"
        ]
      },
      spanish: {
        sectionTitle: "Lo que ayuda a que el día vaya bien",
        promptLabel: "Rutina diaria",
        question:
          "¿Qué rutinas, transiciones, comidas o actividades diarias ayudan a que el día siga su curso?",
        examples: [
          "rutinas de la mañana o de la noche",
          "horarios de comidas y meriendas",
          "apoyos para transiciones, como cuenta regresiva o horarios visuales"
        ]
      },
      mandarin: {
        sectionTitle: "什么有助于让一天顺利进行",
        promptLabel: "日常安排",
        question: "哪些固定流程、转换方式、用餐安排或日常活动能帮助一天顺利进行？",
        examples: [
          "早晨或睡前流程",
          "正餐和点心时间",
          "倒计时或视觉日程等转换支持方式"
        ]
      }
    }
  },
  {
    id: "day-goes-well-activities",
    sectionId: "what_helps_the_day_go_well",
    translations: {
      english: {
        sectionTitle: "What helps the day go well",
        promptLabel: "Activities & preferences",
        question:
          "What activities, outings, people, or quiet-time preferences usually help things go well?",
        examples: [
          "favorite activities, videos, music, crafts, or walks",
          "trusted people they do well with",
          "rest, low-light, or sensory-space preferences"
        ]
      },
      spanish: {
        sectionTitle: "Lo que ayuda a que el día vaya bien",
        promptLabel: "Actividades y preferencias",
        question:
          "¿Qué actividades, salidas, personas o preferencias de tiempo tranquilo suelen ayudar a que todo vaya bien?",
        examples: [
          "actividades favoritas, videos, música, manualidades o caminatas",
          "personas de confianza con quienes se siente bien",
          "preferencias de descanso, poca luz o espacios sensoriales"
        ]
      },
      mandarin: {
        sectionTitle: "什么有助于让一天顺利进行",
        promptLabel: "活动与偏好",
        question: "哪些活动、外出、陪伴的人，或安静时间的偏好，通常能帮助事情顺利进行？",
        examples: [
          "喜欢的活动、视频、音乐、手工或散步",
          "让其感觉安心、配合良好的人",
          "休息、低光环境或感官空间方面的偏好"
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

export function getSummaryFieldLabels(language: UiLanguage) {
  return summaryFieldLabels[language];
}

export function getLocalizedReflectionPrompts(language: UiLanguage): ReflectionPrompt[] {
  return promptDefinitions.map((prompt) => ({
    id: prompt.id,
    sectionId: prompt.sectionId,
    ...prompt.translations[language]
  }));
}
