import { ReflectionPrompt, UiLanguage } from "@/lib/types";

export const QUESTIONNAIRE_VERSION = "2026-06-06-v1";

export const SECTION_INSTRUCTIONS: Record<UiLanguage, string> = {
  english:
    "Answer what you can. Examples are helpful. There are no right or wrong answers. Skip anything that is not relevant or that you do not want to answer. To speak your answers, click the record button.",
  spanish:
    "Responda lo que pueda. Los ejemplos son útiles. No hay respuestas correctas o incorrectas. Omita cualquier pregunta que no sea relevante o que no quiera responder. Para decir sus respuestas en voz alta, pulse el botón de grabación.",
  mandarin:
    "能回答多少就回答多少。示例会有所帮助。答案没有对错之分。任何不相关或您不想回答的问题都可以跳过。要口述回答，请点击录音按钮。"
};

type PromptTranslation = Pick<
  ReflectionPrompt,
  "sectionTitle" | "stepTitle" | "stepCompletionMessage" | "promptLabel" | "question" | "examples"
>;

type PromptDefinition = {
  id: string;
  sectionId: ReflectionPrompt["sectionId"];
  stepId: ReflectionPrompt["stepId"];
  translations: Record<UiLanguage, PromptTranslation>;
};

const completionMessages: Record<UiLanguage, Record<ReflectionPrompt["stepId"], string>> = {
  english: {
    communication: "You completed the Communication section.",
    understanding_learning: "You completed the Understanding and Learning section.",
    daily_schedule: "You completed the Daily Schedule section.",
    activities_preferences: "You completed the Activities & Preferences section.",
    signs_need_help: "You completed the Signs They Are Having a Hard Time section.",
    hard_time_support: "You completed the support section.",
    health_safety: "You completed the Health & Safety section.",
    upset_overwhelm: "You completed this section.",
    who_to_contact: "You completed this section."
  },
  spanish: {
    communication: "Completó la sección Comunicación.",
    understanding_learning: "Completó la sección Comprensión y aprendizaje.",
    daily_schedule: "Completó la sección Rutina diaria.",
    activities_preferences: "Completó la sección Actividades y preferencias.",
    signs_need_help: "Completó la sección Señales de que lo están pasando mal.",
    hard_time_support: "Completó la sección de apoyos.",
    health_safety: "Completó la sección Salud y seguridad.",
    upset_overwhelm: "Completó esta sección.",
    who_to_contact: "Completó esta sección."
  },
  mandarin: {
    communication: "您已完成“沟通”部分。",
    understanding_learning: "您已完成“理解与学习”部分。",
    daily_schedule: "您已完成“日常安排”部分。",
    activities_preferences: "您已完成“活动与偏好”部分。",
    signs_need_help: "您已完成“他们状态不佳的迹象”部分。",
    hard_time_support: "您已完成“状态不佳时的帮助方式”部分。",
    health_safety: "您已完成“健康与安全”部分。",
    upset_overwhelm: "您已完成此部分。",
    who_to_contact: "您已完成此部分。"
  }
};

function translation(
  language: UiLanguage,
  stepId: ReflectionPrompt["stepId"],
  sectionTitle: string,
  question: string,
  examples: string[]
): PromptTranslation {
  return {
    sectionTitle,
    stepTitle: sectionTitle,
    stepCompletionMessage: completionMessages[language][stepId],
    promptLabel: question,
    question,
    examples
  };
}

export const QUESTIONNAIRE_PROMPT_DEFINITIONS: PromptDefinition[] = [
  {
    id: "communication-how-do-they-communicate",
    sectionId: "communication",
    stepId: "communication",
    translations: {
      english: translation("english", "communication", "Communication", "How do they communicate?", [
        "speaking",
        "sounds",
        "gestures",
        "pointing",
        "sign language",
        "communication device",
        "writing",
        "texting",
        "behavior"
      ]),
      spanish: translation("spanish", "communication", "Comunicación", "¿Cómo se comunican?", [
        "hablar",
        "sonidos",
        "gestos",
        "señalar",
        "lengua de señas",
        "dispositivo de comunicación",
        "escribir",
        "mensajes de texto",
        "conducta"
      ]),
      mandarin: translation("mandarin", "communication", "沟通", "他们如何沟通？", [
        "说话",
        "声音",
        "手势",
        "指向",
        "手语",
        "沟通设备",
        "书写",
        "发短信",
        "行为"
      ])
    }
  },
  {
    id: "communication-what-helps-you-communicate",
    sectionId: "communication",
    stepId: "communication",
    translations: {
      english: translation(
        "english",
        "communication",
        "Communication",
        "What helps you communicate with them?",
        [
          "giving limited choices",
          "keeping language simple",
          "waiting before repeating",
          "using pictures",
          "writing",
          "or demonstrations"
        ]
      ),
      spanish: translation(
        "spanish",
        "communication",
        "Comunicación",
        "¿Qué le ayuda a comunicarse con ellos?",
        [
          "dar opciones limitadas",
          "usar lenguaje sencillo",
          "esperar antes de repetir",
          "usar imágenes",
          "escribir",
          "hacer demostraciones"
        ]
      ),
      mandarin: translation("mandarin", "communication", "沟通", "什么方式有助于您与他们沟通？", [
        "提供有限的选择",
        "使用简单语言",
        "重复前先等待",
        "使用图片",
        "书写",
        "示范"
      ])
    }
  },
  {
    id: "communication-what-do-specific-things-mean",
    sectionId: "communication",
    stepId: "communication",
    translations: {
      english: translation(
        "english",
        "communication",
        "Communication",
        "Are there things they say or do that mean something specific? What do they mean?",
        [
          "leading you = wants something",
          "sitting close = wants attention",
          "repeating something = anxious",
          "becoming quiet = something is wrong"
        ]
      ),
      spanish: translation(
        "spanish",
        "communication",
        "Comunicación",
        "¿Hay cosas que dicen o hacen que significan algo específico? ¿Qué significan?",
        [
          "llevarle hacia algo = quiere algo",
          "sentarse cerca = quiere atención",
          "repetir algo = siente ansiedad",
          "quedarse callado = algo no está bien"
        ]
      ),
      mandarin: translation(
        "mandarin",
        "communication",
        "沟通",
        "他们说的某些话或做的某些事是否有特定含义？分别是什么意思？",
        [
          "带您过去 = 想要某样东西",
          "坐得很近 = 想得到关注",
          "重复某件事 = 感到焦虑",
          "变得安静 = 出了问题"
        ]
      )
    }
  },
  {
    id: "understanding-learning-process",
    sectionId: "understanding_learning",
    stepId: "understanding_learning",
    translations: {
      english: translation(
        "english",
        "understanding_learning",
        "Understanding and Learning",
        "How do they learn, understand, and process information?",
        [
          "understands simple one-step directions",
          "learns best by watching",
          "needs extra processing time",
          "understands more than they can express"
        ]
      ),
      spanish: translation(
        "spanish",
        "understanding_learning",
        "Comprensión y aprendizaje",
        "¿Cómo aprenden, comprenden y procesan la información?",
        [
          "comprende instrucciones sencillas de un paso",
          "aprende mejor observando",
          "necesita más tiempo para procesar",
          "comprende más de lo que puede expresar"
        ]
      ),
      mandarin: translation(
        "mandarin",
        "understanding_learning",
        "理解与学习",
        "他们如何学习、理解和处理信息？",
        [
          "能理解简单的单步指令",
          "通过观察学习效果最好",
          "需要更多处理时间",
          "理解能力强于表达能力"
        ]
      )
    }
  },
  {
    id: "understanding-learning-literacy",
    sectionId: "understanding_learning",
    stepId: "understanding_learning",
    translations: {
      english: translation(
        "english",
        "understanding_learning",
        "Understanding and Learning",
        "What can they read, write, and understand?",
        [
          "recognizes pictures",
          "recognizes familiar words",
          "does not read",
          "reads simple words or sentences",
          "reads books or articles",
          "writes independently",
          "understands spoken language better than written information"
        ]
      ),
      spanish: translation(
        "spanish",
        "understanding_learning",
        "Comprensión y aprendizaje",
        "¿Qué pueden leer, escribir y comprender?",
        [
          "reconoce imágenes",
          "reconoce palabras conocidas",
          "no lee",
          "lee palabras u oraciones sencillas",
          "lee libros o artículos",
          "escribe de forma independiente",
          "comprende mejor el lenguaje hablado que la información escrita"
        ]
      ),
      mandarin: translation(
        "mandarin",
        "understanding_learning",
        "理解与学习",
        "他们能够阅读、书写和理解什么？",
        [
          "能识别图片",
          "能识别熟悉的词语",
          "不会阅读",
          "能阅读简单词语或句子",
          "能阅读书籍或文章",
          "能独立书写",
          "对口语的理解好于书面信息"
        ]
      )
    }
  },
  {
    id: "understanding-learning-surprises",
    sectionId: "understanding_learning",
    stepId: "understanding_learning",
    translations: {
      english: translation(
        "english",
        "understanding_learning",
        "Understanding and Learning",
        "What would surprise people about what they can and cannot do?",
        [
          "understands more than they can express",
          "enjoys age-appropriate activities",
          "needs help with safety",
          "can do some things independently",
          "may need support with understanding consequences or making decisions"
        ]
      ),
      spanish: translation(
        "spanish",
        "understanding_learning",
        "Comprensión y aprendizaje",
        "¿Qué sorprendería a otras personas sobre lo que pueden y no pueden hacer?",
        [
          "comprende más de lo que puede expresar",
          "disfruta actividades apropiadas para su edad",
          "necesita ayuda con la seguridad",
          "puede hacer algunas cosas de forma independiente",
          "puede necesitar apoyo para comprender consecuencias o tomar decisiones"
        ]
      ),
      mandarin: translation(
        "mandarin",
        "understanding_learning",
        "理解与学习",
        "关于他们能做和不能做的事情，哪些会让别人感到意外？",
        [
          "理解能力强于表达能力",
          "喜欢符合其年龄的活动",
          "在安全方面需要帮助",
          "有些事情可以独立完成",
          "在理解后果或做决定时可能需要支持"
        ]
      )
    }
  },
  {
    id: "daily-schedule-support-level",
    sectionId: "daily_schedule",
    stepId: "daily_schedule",
    translations: {
      english: translation(
        "english",
        "daily_schedule",
        "Daily Schedule",
        "How much support do they need in daily life?",
        [
          "needs help with most things",
          "needs reminders or supervision",
          "needs help with some things",
          "mostly independent"
        ]
      ),
      spanish: translation(
        "spanish",
        "daily_schedule",
        "Rutina diaria",
        "¿Cuánto apoyo necesitan en la vida diaria?",
        [
          "necesita ayuda con la mayoría de las cosas",
          "necesita recordatorios o supervisión",
          "necesita ayuda con algunas cosas",
          "es mayormente independiente"
        ]
      ),
      mandarin: translation("mandarin", "daily_schedule", "日常安排", "他们在日常生活中需要多少支持？", [
        "大多数事情都需要帮助",
        "需要提醒或监督",
        "有些事情需要帮助",
        "基本可以独立完成"
      ])
    }
  },
  {
    id: "daily-schedule-mornings",
    sectionId: "daily_schedule",
    stepId: "daily_schedule",
    translations: {
      english: translation("english", "daily_schedule", "Daily Schedule", "What is their typical morning routine?", [
        "waking up",
        "bathroom",
        "shower",
        "getting dressed",
        "breakfast",
        "medication",
        "brushing teeth",
        "preparing for work, school, or day program"
      ]),
      spanish: translation("spanish", "daily_schedule", "Rutina diaria", "¿Cuál es su rutina típica por la mañana?", [
        "despertarse",
        "ir al baño",
        "ducharse",
        "vestirse",
        "desayunar",
        "tomar medicamentos",
        "cepillarse los dientes",
        "prepararse para el trabajo, la escuela o el programa diurno"
      ]),
      mandarin: translation("mandarin", "daily_schedule", "日常安排", "他们通常的早晨流程是什么？", [
        "起床",
        "上厕所",
        "淋浴",
        "穿衣",
        "早餐",
        "服药",
        "刷牙",
        "为上班、上学或日间活动做准备"
      ])
    }
  },
  {
    id: "daily-schedule-meals-snacks",
    sectionId: "daily_schedule",
    stepId: "daily_schedule",
    translations: {
      english: translation("english", "daily_schedule", "Daily Schedule", "What are meals and snacks like?", [
        "favorite foods",
        "selective eater",
        "eats on a schedule",
        "grazes throughout the day",
        "needs encouragement to eat or drink",
        "follows meal routines"
      ]),
      spanish: translation("spanish", "daily_schedule", "Rutina diaria", "¿Cómo son las comidas y meriendas?", [
        "alimentos favoritos",
        "es selectivo con la comida",
        "come según un horario",
        "come pequeñas cantidades durante todo el día",
        "necesita ánimo para comer o beber",
        "sigue rutinas para las comidas"
      ]),
      mandarin: translation("mandarin", "daily_schedule", "日常安排", "他们的正餐和点心通常是什么样的？", [
        "最喜欢的食物",
        "挑食",
        "按时间进食",
        "全天少量进食",
        "需要鼓励才会吃喝",
        "遵循固定用餐流程"
      ])
    }
  },
  {
    id: "daily-schedule-bedtime",
    sectionId: "daily_schedule",
    stepId: "daily_schedule",
    translations: {
      english: translation("english", "daily_schedule", "Daily Schedule", "What is their bedtime routine?", [
        "bath or shower",
        "medication",
        "TV or music",
        "favorite blanket or comfort item",
        "phone or tablet",
        "lights out at a certain time"
      ]),
      spanish: translation("spanish", "daily_schedule", "Rutina diaria", "¿Cuál es su rutina para ir a dormir?", [
        "baño o ducha",
        "medicamentos",
        "televisión o música",
        "manta favorita u objeto de consuelo",
        "teléfono o tableta",
        "apagar las luces a una hora determinada"
      ]),
      mandarin: translation("mandarin", "daily_schedule", "日常安排", "他们的睡前流程是什么？", [
        "洗澡或淋浴",
        "服药",
        "电视或音乐",
        "喜欢的毯子或安慰物",
        "手机或平板电脑",
        "固定时间关灯"
      ])
    }
  },
  {
    id: "activities-preferences-favorite-activities",
    sectionId: "activities_preferences",
    stepId: "activities_preferences",
    translations: {
      english: translation(
        "english",
        "activities_preferences",
        "Activities & Preferences",
        "What activities do they enjoy most?",
        ["music", "animals", "books", "technology (iPad, phone, or video games)", "writing", "art", "shopping", "games", "sports"]
      ),
      spanish: translation(
        "spanish",
        "activities_preferences",
        "Actividades y preferencias",
        "¿Qué actividades disfrutan más?",
        ["música", "animales", "libros", "tecnología (iPad, teléfono o videojuegos)", "escritura", "arte", "compras", "juegos", "deportes"]
      ),
      mandarin: translation(
        "mandarin",
        "activities_preferences",
        "活动与偏好",
        "他们最喜欢哪些活动？",
        ["音乐", "动物", "书籍", "科技产品（iPad、手机或电子游戏）", "写作", "艺术", "购物", "游戏", "运动"]
      )
    }
  },
  {
    id: "activities-preferences-outings",
    sectionId: "activities_preferences",
    stepId: "activities_preferences",
    translations: {
      english: translation(
        "english",
        "activities_preferences",
        "Activities & Preferences",
        "What do they enjoy doing outside the home?",
        ["walks", "shopping", "restaurants", "community activities", "visiting friends or family", "car rides"]
      ),
      spanish: translation(
        "spanish",
        "activities_preferences",
        "Actividades y preferencias",
        "¿Qué les gusta hacer fuera de casa?",
        ["caminar", "ir de compras", "ir a restaurantes", "actividades comunitarias", "visitar a amistades o familiares", "paseos en coche"]
      ),
      mandarin: translation(
        "mandarin",
        "activities_preferences",
        "活动与偏好",
        "他们在家外喜欢做什么？",
        ["散步", "购物", "去餐厅", "社区活动", "拜访朋友或家人", "坐车兜风"]
      )
    }
  },
  {
    id: "activities-preferences-trusted-people",
    sectionId: "activities_preferences",
    stepId: "activities_preferences",
    translations: {
      english: translation(
        "english",
        "activities_preferences",
        "Activities & Preferences",
        "Who do they enjoy spending time with?",
        ["family", "friends", "pets", "caregivers", "people from work, school, or community groups"]
      ),
      spanish: translation(
        "spanish",
        "activities_preferences",
        "Actividades y preferencias",
        "¿Con quién disfrutan pasar tiempo?",
        ["familia", "amistades", "mascotas", "personas cuidadoras", "personas del trabajo, la escuela o grupos comunitarios"]
      ),
      mandarin: translation(
        "mandarin",
        "activities_preferences",
        "活动与偏好",
        "他们喜欢和谁待在一起？",
        ["家人", "朋友", "宠物", "照护者", "工作单位、学校或社区团体中的人"]
      )
    }
  },
  {
    id: "hard-time-signs-situations-changes",
    sectionId: "signs_hard_time",
    stepId: "signs_need_help",
    translations: {
      english: translation(
        "english",
        "signs_need_help",
        "Signs They Are Having a Hard Time",
        "What situations or changes can make things harder for them?",
        [
          "changes in routine",
          "waiting",
          "being rushed",
          "loud noise",
          "crowded places",
          "hunger",
          "thirst",
          "pain",
          "poor sleep",
          "illness",
          "medication changes",
          "being too hot or cold"
        ]
      ),
      spanish: translation(
        "spanish",
        "signs_need_help",
        "Señales de que lo están pasando mal",
        "¿Qué situaciones o cambios pueden hacer que las cosas sean más difíciles para ellos?",
        [
          "cambios de rutina",
          "esperar",
          "tener prisa",
          "ruidos fuertes",
          "lugares concurridos",
          "hambre",
          "sed",
          "dolor",
          "dormir mal",
          "enfermedad",
          "cambios de medicación",
          "tener demasiado calor o frío"
        ]
      ),
      mandarin: translation(
        "mandarin",
        "signs_need_help",
        "他们状态不佳的迹象",
        "哪些情况或变化会让他们更难应对？",
        [
          "日常流程改变",
          "等待",
          "被催促",
          "噪音大",
          "拥挤的地方",
          "饥饿",
          "口渴",
          "疼痛",
          "睡眠不足",
          "生病",
          "药物变化",
          "太热或太冷"
        ]
      )
    }
  },
  {
    id: "signs-need-help-body-signs",
    sectionId: "signs_hard_time",
    stepId: "signs_need_help",
    translations: {
      english: translation(
        "english",
        "signs_need_help",
        "Signs They Are Having a Hard Time",
        "What signs in their body show they may need help?",
        [
          "low energy",
          "limping",
          "signs of pain",
          "changes in eating or drinking",
          "breathing changes",
          "covering ears or eyes",
          "staring and not responding",
          "body stiffening or jerking movements"
        ]
      ),
      spanish: translation(
        "spanish",
        "signs_need_help",
        "Señales de que lo están pasando mal",
        "¿Qué señales en su cuerpo muestran que pueden necesitar ayuda?",
        [
          "poca energía",
          "cojear",
          "señales de dolor",
          "cambios al comer o beber",
          "cambios en la respiración",
          "cubrirse los oídos o los ojos",
          "mirada fija sin responder",
          "rigidez corporal o movimientos bruscos"
        ]
      ),
      mandarin: translation(
        "mandarin",
        "signs_need_help",
        "他们状态不佳的迹象",
        "他们身体上的哪些迹象表明可能需要帮助？",
        [
          "精力不足",
          "跛行",
          "疼痛迹象",
          "饮食或饮水变化",
          "呼吸变化",
          "捂住耳朵或眼睛",
          "发呆且没有反应",
          "身体僵硬或抽动"
        ]
      )
    }
  },
  {
    id: "hard-time-signs-behavior-communication",
    sectionId: "signs_hard_time",
    stepId: "signs_need_help",
    translations: {
      english: translation(
        "english",
        "signs_need_help",
        "Signs They Are Having a Hard Time",
        "What changes in their behavior or communication show they may need help?",
        [
          "pacing or repetitive movements",
          "yelling or becoming quieter",
          "aggression or self-injury",
          "withdrawing from people or activities",
          "running away",
          "repeating words or phrases",
          "difficulty communicating or responding"
        ]
      ),
      spanish: translation(
        "spanish",
        "signs_need_help",
        "Señales de que lo están pasando mal",
        "¿Qué cambios en su conducta o comunicación muestran que pueden necesitar ayuda?",
        [
          "caminar de un lado a otro o hacer movimientos repetitivos",
          "gritar o quedarse más callado",
          "agresión o autolesión",
          "alejarse de personas o actividades",
          "salir corriendo",
          "repetir palabras o frases",
          "dificultad para comunicarse o responder"
        ]
      ),
      mandarin: translation(
        "mandarin",
        "signs_need_help",
        "他们状态不佳的迹象",
        "他们行为或沟通上的哪些变化表明可能需要帮助？",
        [
          "来回踱步或重复动作",
          "大喊或变得更安静",
          "攻击或自伤",
          "回避人或活动",
          "跑开",
          "重复词语或短语",
          "沟通或回应困难"
        ]
      )
    }
  },
  {
    id: "hard-time-support-environment",
    sectionId: "hard_time_support",
    stepId: "hard_time_support",
    translations: {
      english: translation(
        "english",
        "hard_time_support",
        "What helps when they are having a hard time",
        "What changes to the environment help?",
        ["moving to a quieter place", "going outside or for a car ride", "reducing noise", "dimming lights", "giving space", "having fewer people around", "staying nearby"]
      ),
      spanish: translation(
        "spanish",
        "hard_time_support",
        "Qué ayuda cuando lo están pasando mal",
        "¿Qué cambios en el entorno ayudan?",
        ["ir a un lugar más tranquilo", "salir afuera o dar un paseo en coche", "reducir el ruido", "bajar las luces", "dar espacio", "tener menos personas alrededor", "permanecer cerca"]
      ),
      mandarin: translation(
        "mandarin",
        "hard_time_support",
        "当他们状态不好时，什么会有帮助",
        "环境上做哪些调整会有帮助？",
        ["换到更安静的地方", "到户外或坐车兜风", "减少噪音", "调暗灯光", "给予空间", "减少周围人数", "留在附近"]
      )
    }
  },
  {
    id: "hard-time-support-calming-items",
    sectionId: "hard_time_support",
    stepId: "hard_time_support",
    translations: {
      english: translation(
        "english",
        "hard_time_support",
        "What helps when they are having a hard time",
        "What calming items help them?",
        ["favorite item", "headphones or music", "fidgets or weighted blankets", "phone or tablet", "favorite drink or snack", "pets", "preferred activities"]
      ),
      spanish: translation(
        "spanish",
        "hard_time_support",
        "Qué ayuda cuando lo están pasando mal",
        "¿Qué objetos les ayudan a calmarse?",
        ["objeto favorito", "audífonos o música", "juguetes sensoriales o mantas con peso", "teléfono o tableta", "bebida o merienda favorita", "mascotas", "actividades preferidas"]
      ),
      mandarin: translation(
        "mandarin",
        "hard_time_support",
        "当他们状态不好时，什么会有帮助",
        "哪些安抚物品会对他们有帮助？",
        ["喜欢的物品", "耳机或音乐", "指尖玩具或加重毯", "手机或平板电脑", "喜欢的饮料或点心", "宠物", "喜欢的活动"]
      )
    }
  },
  {
    id: "hard-time-support-transitions",
    sectionId: "hard_time_support",
    stepId: "hard_time_support",
    translations: {
      english: translation(
        "english",
        "hard_time_support",
        "What helps when they are having a hard time",
        "What helps with transitions?",
        ["countdowns or timers", "knowing the plan ahead of time", "visual or written schedules", "extra time to prepare", "incentives (like candy or a favorite activity)", "reassurance"]
      ),
      spanish: translation(
        "spanish",
        "hard_time_support",
        "Qué ayuda cuando lo están pasando mal",
        "¿Qué ayuda con las transiciones?",
        ["cuentas regresivas o temporizadores", "conocer el plan de antemano", "horarios visuales o escritos", "tiempo adicional para prepararse", "incentivos (como dulces o una actividad favorita)", "tranquilizar y dar seguridad"]
      ),
      mandarin: translation(
        "mandarin",
        "hard_time_support",
        "当他们状态不好时，什么会有帮助",
        "哪些方式有助于过渡转换？",
        ["倒计时或计时器", "提前知道计划", "视觉或书面日程", "给予更多准备时间", "奖励（如糖果或喜欢的活动）", "安抚和保证"]
      )
    }
  },
  {
    id: "health-safety-diagnoses",
    sectionId: "health_safety",
    stepId: "health_safety",
    translations: {
      english: translation(
        "english",
        "health_safety",
        "Health & Safety",
        "What diagnoses, disabilities, or conditions should others know about?",
        ["intellectual disability", "Down syndrome", "autism", "cerebral palsy", "epilepsy", "ADHD", "dementia", "mental health conditions", "developmental delay", "rare genetic conditions", "asthma", "diabetes", "vision or hearing loss"]
      ),
      spanish: translation(
        "spanish",
        "health_safety",
        "Salud y seguridad",
        "¿Qué diagnósticos, discapacidades o condiciones deberían conocer otras personas?",
        ["discapacidad intelectual", "síndrome de Down", "autismo", "parálisis cerebral", "epilepsia", "TDAH", "demencia", "condiciones de salud mental", "retraso del desarrollo", "condiciones genéticas poco frecuentes", "asma", "diabetes", "pérdida de visión o audición"]
      ),
      mandarin: translation(
        "mandarin",
        "health_safety",
        "健康与安全",
        "其他人应该了解哪些诊断、残障或健康状况？",
        ["智力障碍", "唐氏综合征", "自闭症", "脑瘫", "癫痫", "注意缺陷多动障碍", "失智症", "心理健康状况", "发育迟缓", "罕见遗传病", "哮喘", "糖尿病", "视力或听力损失"]
      )
    }
  },
  {
    id: "health-safety-allergies",
    sectionId: "health_safety",
    stepId: "health_safety",
    translations: {
      english: translation("english", "health_safety", "Health & Safety", "Are there any allergies?", ["food", "medication", "animals", "latex", "insect stings or bites", "adhesives"]),
      spanish: translation("spanish", "health_safety", "Salud y seguridad", "¿Tienen alguna alergia?", ["alimentos", "medicamentos", "animales", "látex", "picaduras o mordeduras de insectos", "adhesivos"]),
      mandarin: translation("mandarin", "health_safety", "健康与安全", "他们有过敏吗？", ["食物", "药物", "动物", "乳胶", "昆虫叮咬", "黏合剂"])
    }
  },
  {
    id: "health-safety-medications",
    sectionId: "health_safety",
    stepId: "health_safety",
    translations: {
      english: translation(
        "english",
        "health_safety",
        "Health & Safety",
        "Do they take any medication and what should others know about it?",
        ["when they take it", "with food", "crushed or liquid", "needs reminders", "emergency medication"]
      ),
      spanish: translation(
        "spanish",
        "health_safety",
        "Salud y seguridad",
        "¿Toman algún medicamento y qué deberían saber otras personas al respecto?",
        ["cuándo lo toman", "con comida", "triturado o líquido", "necesita recordatorios", "medicamento de emergencia"]
      ),
      mandarin: translation(
        "mandarin",
        "health_safety",
        "健康与安全",
        "他们是否服用药物？其他人需要了解哪些事项？",
        ["服药时间", "是否随餐", "碾碎或液体形式", "需要提醒", "急救药物"]
      )
    }
  },
  {
    id: "health-safety-equipment-supports",
    sectionId: "health_safety",
    stepId: "health_safety",
    translations: {
      english: translation("english", "health_safety", "Health & Safety", "Do they use any equipment or supports?", ["glasses", "hearing aids", "communication device", "wheelchair", "cane", "braces", "feeding tube", "headphones", "sensory supports"]),
      spanish: translation("spanish", "health_safety", "Salud y seguridad", "¿Usan algún equipo o apoyo?", ["gafas", "audífonos", "dispositivo de comunicación", "silla de ruedas", "bastón", "férulas", "sonda de alimentación", "auriculares", "apoyos sensoriales"]),
      mandarin: translation("mandarin", "health_safety", "健康与安全", "他们是否使用任何设备或辅助工具？", ["眼镜", "助听器", "沟通设备", "轮椅", "手杖", "支具", "喂食管", "耳机", "感官支持工具"])
    }
  },
  {
    id: "health-safety-supervision",
    sectionId: "health_safety",
    stepId: "health_safety",
    translations: {
      english: translation(
        "english",
        "health_safety",
        "Health & Safety",
        "Do they need supervision for safety?",
        ["can be left alone", "needs occasional checks", "requires constant supervision", "may wander or leave unexpectedly", "may not recognize danger"]
      ),
      spanish: translation(
        "spanish",
        "health_safety",
        "Salud y seguridad",
        "¿Necesitan supervisión por seguridad?",
        ["puede quedarse solo", "necesita revisiones ocasionales", "requiere supervisión constante", "puede deambular o irse inesperadamente", "puede no reconocer el peligro"]
      ),
      mandarin: translation(
        "mandarin",
        "health_safety",
        "健康与安全",
        "为了安全，他们是否需要监督？",
        ["可以独处", "需要偶尔查看", "需要持续监督", "可能走失或突然离开", "可能无法识别危险"]
      )
    }
  },
  {
    id: "health-safety-contact-guidance",
    sectionId: "health_safety",
    stepId: "health_safety",
    translations: {
      english: translation(
        "english",
        "health_safety",
        "Health & Safety",
        "If something happens, who should be contacted and what should others know about when to call?",
        ["911 in an emergency", "parent or guardian", "doctor or nurse", "who to contact first", "when to call right away", "when it is okay to wait and monitor"]
      ),
      spanish: translation(
        "spanish",
        "health_safety",
        "Salud y seguridad",
        "Si ocurre algo, ¿a quién se debe contactar y qué deberían saber otras personas sobre cuándo llamar?",
        ["911 en una emergencia", "madre, padre o tutor", "médico o enfermero", "a quién contactar primero", "cuándo llamar de inmediato", "cuándo está bien esperar y observar"]
      ),
      mandarin: translation(
        "mandarin",
        "health_safety",
        "健康与安全",
        "如果发生情况，应该联系谁？其他人需要知道何时应该打电话？",
        ["紧急情况拨打 911", "父母或监护人", "医生或护士", "先联系谁", "何时应立即打电话", "何时可以等待并观察"]
      )
    }
  }
];

export function getQuestionnairePrompts(language: UiLanguage): ReflectionPrompt[] {
  return QUESTIONNAIRE_PROMPT_DEFINITIONS.map((prompt) => ({
    id: prompt.id,
    sectionId: prompt.sectionId,
    stepId: prompt.stepId,
    stepSubtitle: SECTION_INSTRUCTIONS[language],
    ...prompt.translations[language]
  }));
}
