// GENERATED FILE. DO NOT EDIT.
// Sources: data/furniture-rules/v1/{SCENARIO_LIBRARY_RU,PROFILES_RU,EVALUATORS_RU}.json
// Rebuild: node scripts/import-layout-knowledge.mjs

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export const LAYOUT_KNOWLEDGE_PROVENANCE = deepFreeze({
  "version": "1.0.0",
  "sources": {
    "scenarios": {
      "file": "data/furniture-rules/v1/SCENARIO_LIBRARY_RU.json",
      "sha256": "5887dc161e947ace3ea363e71642c6bc130a88a8a49344ee652c54a256f60f7d"
    },
    "profiles": {
      "file": "data/furniture-rules/v1/PROFILES_RU.json",
      "sha256": "d18e83349735a5beb4aa4c6bc389fdf2ee34effd70213aa8cf0aec849ed10e3d"
    },
    "evaluators": {
      "file": "data/furniture-rules/v1/EVALUATORS_RU.json",
      "sha256": "57015f43c1cbedeed2dc3423cfc74e2653a5da372bf65bdc1d99473ad126139a"
    }
  }
});

export const LAYOUT_SCENARIO_LIBRARY = deepFreeze({
  "document_type": "furniture_layout_scenario_library",
  "version": "1.0.0",
  "language": "ru",
  "status": "specification_only",
  "units": {
    "length": "mm",
    "angles": "degrees",
    "time": "minutes"
  },
  "integration": {
    "brief_file": "BRIEF_TEMPLATE_RU.json",
    "core_rule_ids": "SCN001–SCN020",
    "ids_are_stable": true
  },
  "execution_policy": {
    "activation": "enabled=null означает применимость ещё не выяснена; enabled=false пропускает сценарий; enabled=true запускает только заполненные подтверждённые ветви.",
    "mandatory": "mandatory задаётся брифом. Обязательный сценарий требует запуска и выполнения явно обязательных функций, но не превращает каждую мягкую цель в hard.",
    "actors": "roles являются шаблонами участников, а не реальными людьми. count/person_ids=null до привязки; один человек не моделируется одновременно в несовместимых позах или местах.",
    "states": "required_states задают проверяемые состояния и фазы. Множество states не означает их одновременное включение.",
    "parallel": "required_parallel_task_groups действуют только при истинном condition и разных совместимых ресурсах. Состав участников, числа и частоты не выводятся автоматически.",
    "optional_features": "Отсутствующая опциональная функция при подтверждённом отсутствии даёт not_applicable; неизвестная — unknown, а не автоматически отсутствует.",
    "checks": "required_checks применяются условно по объекту и активному профилю; metric result вычисляется валидатором, язык модели не является результатом проверки.",
    "comfort": "comfort_checks остаются soft. Для усиления нужна ссылка promotion_to_hard_requirement_id на измеримое явное требование; закон и паспорт изменять таким способом нельзя.",
    "unknown": "При отсутствии критических входов не выдавать verified. Допустим концептуальный вариант с unknown и missing_inputs.",
    "states_of_results": [
      "pass",
      "fail",
      "unknown",
      "not_applicable"
    ],
    "dimensions": "Все фактические размеры берутся из геометрии и профилей; здесь нет выдуманных ширин, частот, состава семьи и результатов."
  },
  "metric_catalog": {
    "solid_collisions_count": {
      "unit": "count",
      "description": "Число недопустимых пересечений реальных твёрдых тел в совместимых состояниях."
    },
    "swept_collisions_count": {
      "unit": "count",
      "description": "Число столкновений тела/груза на траектории или при пользовании мебелью."
    },
    "required_route_reachable": {
      "unit": "boolean",
      "description": "Достижимы ли заданные узлы с геометрией пользователя и разрешённой последовательностью действий."
    },
    "minimum_clear_width": {
      "unit": "mm",
      "description": "Минимальная остаточная ширина пути в конкретном состоянии; измеряется между препятствиями, без повторного учёта тела/буфера."
    },
    "route_length": {
      "unit": "mm",
      "description": "Длина допустимой траектории между фактическими якорями сценария."
    },
    "route_turns": {
      "unit": "count",
      "description": "Число существенных поворотов по согласованному порогу; порог хранится в профиле."
    },
    "task_success": {
      "unit": "boolean",
      "description": "Выполнимость конкретного действия при требуемом состоянии мебели и пользователя."
    },
    "required_capacity": {
      "unit": "count",
      "description": "Число одновременно пригодных мест; сравнивается с брифом, не с количеством нарисованных символов."
    },
    "storage_capacity_match": {
      "unit": "boolean",
      "description": "Предусмотрено ли подходящее хранение для реального инвентаря, включая временно убранную мебель."
    },
    "active_safety_rules": {
      "unit": "rule_results",
      "description": "Результаты применимых подтверждённых правил безопасности и паспортов; unknown не преобразуется в pass."
    },
    "thermal_service_clearance": {
      "unit": "mm_or_volume",
      "description": "Соответствие отдельным паспортным зонам конкретного оборудования; единого численного порога нет."
    },
    "private_view_exposure": {
      "unit": "fraction_or_visibility",
      "description": "Видимость согласованной приватной зоны из заданных глаз/камер; порог задаёт пользователь."
    },
    "view_target_visibility": {
      "unit": "fraction_or_visibility",
      "description": "Видимость целевого объекта из реального места и позы пользователя."
    },
    "glare_risk": {
      "unit": "method_specific",
      "description": "Оценка по указанной методике; наличие красивого рендера не доказывает отсутствие бликов."
    },
    "illuminance_at_task": {
      "unit": "lx",
      "description": "Освещённость рабочей поверхности, только при доступных светотехнических данных."
    },
    "noise_exposure": {
      "unit": "method_specific",
      "description": "Качественный риск или расчётное значение с названной моделью; мебель не доказывает звукоизоляцию."
    },
    "activity_interruptions": {
      "unit": "count",
      "description": "Ожидаемые прерывания выбранного действия проходом, доступом к общему хранению или светом."
    },
    "route_activity_intersections": {
      "unit": "count",
      "description": "Пересечения реально одновременных путей и зон деятельности; абстрактное пересечение use_zone не является столкновением."
    },
    "hand_carry_reachability": {
      "unit": "boolean",
      "description": "Проходимость с фактическим грузом и возможность поставить его в необходимых точках."
    },
    "change_cost": {
      "unit": "project_defined",
      "description": "Трудоёмкость/стоимость перехода между подтверждёнными конфигурациями; без данных цена неизвестна."
    },
    "maintenance_access": {
      "unit": "boolean",
      "description": "Возможность штатного доступа, снятия панели и извлечения части по инструкции."
    },
    "cleanable_surface_fraction": {
      "unit": "fraction",
      "description": "Доля поверхностей, доступных выбранному способу уборки; порог проектный."
    },
    "child_hazard_reachability": {
      "unit": "boolean",
      "description": "Достижимость опасного окна/ограждения/горячей зоны с учётом лазания; проверяется по профилю и не по одной дистанции."
    },
    "observed_user_ergonomics": {
      "unit": "profile_results",
      "description": "Совместимость с измерениями и функциональными потребностями фактического пользователя."
    }
  },
  "scenario_count": 20,
  "scenarios": [
    {
      "scenario_id": "SCN001",
      "core_rule_id": "SCN001",
      "title": "Возвращение семьи",
      "description": "Два человека входят с пакетами, снимают обувь и одежду, один проходит в дом.",
      "status": "specification_only",
      "enabled": null,
      "mandatory": null,
      "activation_condition": "Подтверждён совместный приход нескольких людей; число и состав не выводятся из типа дома.",
      "frequency": {
        "value": null,
        "period": null,
        "seasonality": null,
        "source_id": null
      },
      "priority": null,
      "actors": [
        {
          "role_id": "arriving",
          "description": "Входящие люди с вещами",
          "person_ids": null,
          "count": null,
          "binding_source": "brief.daily_life.entrance",
          "body_or_device_model_ref": null,
          "carried_objects": null,
          "binding_verified": null
        },
        {
          "role_id": "passing",
          "description": "Проходящий в чистую часть дома",
          "person_ids": null,
          "count": null,
          "binding_source": "brief.household.members",
          "body_or_device_model_ref": null,
          "carried_objects": null,
          "binding_verified": null
        }
      ],
      "tasks": [
        {
          "task_id": "enter",
          "actor_role": "arriving",
          "action": "Открыть входную дверь и войти с вещами",
          "target_anchor_role": "entry",
          "depends_on": [],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Сценарий включён, функция подтверждена брифом и участник привязан"
        },
        {
          "task_id": "stage_bags",
          "actor_role": "arriving",
          "action": "Поставить сумки на предусмотренное место",
          "target_anchor_role": "bag_staging",
          "depends_on": [
            "enter"
          ],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Сценарий включён, функция подтверждена брифом и участник привязан"
        },
        {
          "task_id": "remove_shoes",
          "actor_role": "arriving",
          "action": "Снять обувь сидя или стоя по привычке",
          "target_anchor_role": "entry_seat",
          "depends_on": [
            "stage_bags"
          ],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Сценарий включён, функция подтверждена брифом и участник привязан"
        },
        {
          "task_id": "store_clothes",
          "actor_role": "arriving",
          "action": "Убрать одежду и обувь",
          "target_anchor_role": "entry_storage",
          "depends_on": [
            "remove_shoes"
          ],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Сценарий включён, функция подтверждена брифом и участник привязан"
        },
        {
          "task_id": "pass_inside",
          "actor_role": "passing",
          "action": "Пройти из прихожей внутрь дома",
          "target_anchor_role": "clean_zone",
          "depends_on": [],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Сценарий включён, функция подтверждена брифом и участник привязан"
        }
      ],
      "required_states": [
        {
          "state_id": "ENTRY_USE",
          "description": "Дверь движется, место переобувания занято, часть хранения открыта по фазе",
          "object_state_requirements": {
            "entry_door": "swept_required_angle",
            "entry_seat": "occupied",
            "bag_staging": "contains_actual_bags",
            "storage_fronts": "opened_only_for_active_task"
          },
          "activation_condition": "Если соответствующий объект имеется и используется в этом сценарии",
          "concrete_object_ids": null,
          "verified": null
        }
      ],
      "route_pairs": [
        {
          "route_id": "entry_to_seat",
          "actor_role": "arriving",
          "from_anchor_role": "entry",
          "to_anchor_role": "entry_seat",
          "state_ids": [
            "ENTRY_USE"
          ],
          "carried_object_role": "bags",
          "concrete_anchor_ids": null,
          "metrics": null,
          "status": "specification_only"
        },
        {
          "route_id": "entry_to_clean",
          "actor_role": "passing",
          "from_anchor_role": "entry",
          "to_anchor_role": "clean_zone",
          "state_ids": [
            "ENTRY_USE"
          ],
          "carried_object_role": null,
          "concrete_anchor_ids": null,
          "metrics": null,
          "status": "specification_only"
        }
      ],
      "concurrency": {
        "required_parallel_task_groups": [
          {
            "task_ids": [
              "remove_shoes",
              "pass_inside"
            ],
            "condition": "Только при подтверждённом совместном приходе и разных участниках"
          }
        ],
        "mutually_exclusive_state_groups": [],
        "sequence_source": "tasks.depends_on",
        "user_confirmed": null,
        "policy": "Не объединять все открытые дверцы и все варианты состояния в один физически невозможный кадр. Одновременность связывается с конкретными участниками и фазами; последовательность проверяется отдельно.",
        "resource_policy": "Один конкретный человек и один предмет не могут одновременно занимать несовместимые позы/места. Параллельные задачи одной роли требуют разных actor_instance_id, кроме явно совместимых составных действий."
      },
      "required_checks": [
        {
          "check_id": "SCN001-R01",
          "description": "Нет недопустимых столкновений предметов и тела в требуемых совместимых состояниях.",
          "metric_id": "solid_collisions_count",
          "rule_refs": [
            "GEO004",
            "GEO005",
            "GEO014"
          ],
          "threshold_source": "Физическая совместимость; допустимые сопряжения указаны в модели",
          "expected_value": 0,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        },
        {
          "check_id": "SCN001-R02",
          "description": "Все обязательные действия и их входные/выходные маршруты доступны конкретным участникам.",
          "metric_id": "required_route_reachable",
          "rule_refs": [
            "PATH001",
            "PATH002",
            "GEO016"
          ],
          "threshold_source": "Обязательные функции выбранного сценария",
          "expected_value": true,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        },
        {
          "check_id": "SCN001-R03",
          "description": "Выполнены активные требования безопасности и ограничения паспортов; неизвестные данные остаются unknown.",
          "metric_id": "active_safety_rules",
          "rule_refs": [
            "OPT002",
            "OPT003",
            "QA006"
          ],
          "threshold_source": "Только подтверждённые применимые требования",
          "expected_value": null,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        },
        {
          "check_id": "SCN001-R04",
          "description": "Сумки и человек у скамьи не блокируют требуемый дверной цикл.",
          "metric_id": "task_success",
          "rule_refs": [
            "GEO008",
            "PATH017"
          ],
          "threshold_source": "Геометрия задачи",
          "expected_value": true,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        }
      ],
      "comfort_checks": [
        {
          "check_id": "SCN001-C01",
          "description": "Короткая последовательность вход→вещи→чистая зона без повторных обходов.",
          "metric_id": "route_length",
          "rule_refs": [
            "PATH017"
          ],
          "threshold_source": "Мягкая цель брифа или дизайн-профиля",
          "expected_value": null,
          "observed_value": null,
          "result": null,
          "status": "specification_only",
          "severity": "soft",
          "weight": null,
          "target_value": null,
          "promotion_to_hard_requirement_id": null
        },
        {
          "check_id": "SCN001-C02",
          "description": "Одежда и обувь удобно доступны после переобувания.",
          "metric_id": "observed_user_ergonomics",
          "rule_refs": [
            "IN015"
          ],
          "threshold_source": "Мягкая цель брифа или дизайн-профиля",
          "expected_value": null,
          "observed_value": null,
          "result": null,
          "status": "specification_only",
          "severity": "soft",
          "weight": null,
          "target_value": null,
          "promotion_to_hard_requirement_id": null
        }
      ],
      "missing_inputs": [
        {
          "field_path": "brief.daily_life.entrance",
          "reason": "Нужны число входящих, обувной сценарий и реальные вещи.",
          "value": null,
          "blocking_scope": "scenario"
        },
        {
          "field_path": "brief.building.openings",
          "reason": "Нужны входная дверь и её движение.",
          "value": null,
          "blocking_scope": "geometry"
        },
        {
          "field_path": "brief.household.members",
          "reason": "Нужны тела и доступность участников.",
          "value": null,
          "blocking_scope": "scenario"
        }
      ],
      "execution_results": null
    },
    {
      "scenario_id": "SCN002",
      "core_rule_id": "SCN002",
      "title": "Утренние сборы",
      "description": "Один человек спит, другой идет в гардероб и ванную, одевается и выходит.",
      "status": "specification_only",
      "enabled": null,
      "mandatory": null,
      "activation_condition": "Подтверждены разные режимы сна и сборов у совместно использующих спальню людей.",
      "frequency": {
        "value": null,
        "period": null,
        "seasonality": null,
        "source_id": null
      },
      "priority": null,
      "actors": [
        {
          "role_id": "sleeper",
          "description": "Спящий пользователь",
          "person_ids": null,
          "count": null,
          "binding_source": "brief.daily_life.sleep",
          "body_or_device_model_ref": null,
          "carried_objects": null,
          "binding_verified": null
        },
        {
          "role_id": "getting_ready",
          "description": "Собирающийся пользователь",
          "person_ids": null,
          "count": null,
          "binding_source": "brief.daily_life.habits",
          "body_or_device_model_ref": null,
          "carried_objects": null,
          "binding_verified": null
        }
      ],
      "tasks": [
        {
          "task_id": "sleep",
          "actor_role": "sleeper",
          "action": "Лежать и спать",
          "target_anchor_role": "bed_sleep_side",
          "depends_on": [],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Сценарий включён, функция подтверждена брифом и участник привязан"
        },
        {
          "task_id": "rise",
          "actor_role": "getting_ready",
          "action": "Встать со своей стороны кровати",
          "target_anchor_role": "bed_exit_side",
          "depends_on": [],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Сценарий включён, функция подтверждена брифом и участник привязан"
        },
        {
          "task_id": "wardrobe",
          "actor_role": "getting_ready",
          "action": "Взять одежду и переодеться",
          "target_anchor_role": "wardrobe",
          "depends_on": [
            "rise"
          ],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Сценарий включён, функция подтверждена брифом и участник привязан"
        },
        {
          "task_id": "bathroom",
          "actor_role": "getting_ready",
          "action": "Воспользоваться назначенным санузлом",
          "target_anchor_role": "bathroom",
          "depends_on": [
            "rise"
          ],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Сценарий включён, функция подтверждена брифом и участник привязан"
        },
        {
          "task_id": "leave",
          "actor_role": "getting_ready",
          "action": "Выйти из спальни",
          "target_anchor_role": "bedroom_exit",
          "depends_on": [
            "wardrobe",
            "bathroom"
          ],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Сценарий включён, функция подтверждена брифом и участник привязан"
        }
      ],
      "required_states": [
        {
          "state_id": "MORNING",
          "description": "Один человек лежит, другой действует; свет и фасады меняются по фазе",
          "object_state_requirements": {
            "bed": "occupied_by_sleeper",
            "wardrobe": "active_front_open_only",
            "curtains": "selected_sleep_state",
            "lights": "individual_morning_mode"
          },
          "activation_condition": "Если соответствующий объект имеется и используется в этом сценарии",
          "concrete_object_ids": null,
          "verified": null
        }
      ],
      "route_pairs": [
        {
          "route_id": "bed_to_wardrobe",
          "actor_role": "getting_ready",
          "from_anchor_role": "bed_exit_side",
          "to_anchor_role": "wardrobe",
          "state_ids": [
            "MORNING"
          ],
          "carried_object_role": null,
          "concrete_anchor_ids": null,
          "metrics": null,
          "status": "specification_only"
        },
        {
          "route_id": "bed_to_bathroom",
          "actor_role": "getting_ready",
          "from_anchor_role": "bed_exit_side",
          "to_anchor_role": "bathroom",
          "state_ids": [
            "MORNING"
          ],
          "carried_object_role": null,
          "concrete_anchor_ids": null,
          "metrics": null,
          "status": "specification_only"
        },
        {
          "route_id": "wardrobe_to_exit",
          "actor_role": "getting_ready",
          "from_anchor_role": "wardrobe",
          "to_anchor_role": "bedroom_exit",
          "state_ids": [
            "MORNING"
          ],
          "carried_object_role": null,
          "concrete_anchor_ids": null,
          "metrics": null,
          "status": "specification_only"
        }
      ],
      "concurrency": {
        "required_parallel_task_groups": [
          {
            "task_ids": [
              "sleep",
              "wardrobe"
            ],
            "condition": "Разные подтверждённые пользователи; сон продолжается во время выбора одежды"
          },
          {
            "task_ids": [
              "sleep",
              "bathroom"
            ],
            "condition": "Следующая или альтернативная фаза: сон продолжается во время посещения санузла"
          }
        ],
        "mutually_exclusive_state_groups": [],
        "sequence_source": "tasks.depends_on",
        "user_confirmed": null,
        "policy": "Не объединять все открытые дверцы и все варианты состояния в один физически невозможный кадр. Одновременность связывается с конкретными участниками и фазами; последовательность проверяется отдельно.",
        "resource_policy": "Один конкретный человек и один предмет не могут одновременно занимать несовместимые позы/места. Параллельные задачи одной роли требуют разных actor_instance_id, кроме явно совместимых составных действий."
      },
      "required_checks": [
        {
          "check_id": "SCN002-R01",
          "description": "Нет недопустимых столкновений предметов и тела в требуемых совместимых состояниях.",
          "metric_id": "solid_collisions_count",
          "rule_refs": [
            "GEO004",
            "GEO005",
            "GEO014"
          ],
          "threshold_source": "Физическая совместимость; допустимые сопряжения указаны в модели",
          "expected_value": 0,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        },
        {
          "check_id": "SCN002-R02",
          "description": "Все обязательные действия и их входные/выходные маршруты доступны конкретным участникам.",
          "metric_id": "required_route_reachable",
          "rule_refs": [
            "PATH001",
            "PATH002",
            "GEO016"
          ],
          "threshold_source": "Обязательные функции выбранного сценария",
          "expected_value": true,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        },
        {
          "check_id": "SCN002-R03",
          "description": "Выполнены активные требования безопасности и ограничения паспортов; неизвестные данные остаются unknown.",
          "metric_id": "active_safety_rules",
          "rule_refs": [
            "OPT002",
            "OPT003",
            "QA006"
          ],
          "threshold_source": "Только подтверждённые применимые требования",
          "expected_value": null,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        },
        {
          "check_id": "SCN002-R04",
          "description": "Вставание и выход возможны без перешагивания через спящего или постель.",
          "metric_id": "swept_collisions_count",
          "rule_refs": [
            "GEO013",
            "PATH012"
          ],
          "threshold_source": "Физическая совместимость",
          "expected_value": 0,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        }
      ],
      "comfort_checks": [
        {
          "check_id": "SCN002-C01",
          "description": "Меньше света и шума в зоне лица спящего.",
          "metric_id": "activity_interruptions",
          "rule_refs": [
            "LGT009",
            "LGT021",
            "ACOU003"
          ],
          "threshold_source": "Мягкая цель брифа или дизайн-профиля",
          "expected_value": null,
          "observed_value": null,
          "result": null,
          "status": "specification_only",
          "severity": "soft",
          "weight": null,
          "target_value": null,
          "promotion_to_hard_requirement_id": null
        },
        {
          "check_id": "SCN002-C02",
          "description": "Сборы не требуют использовать индивидуальное хранение спящего.",
          "metric_id": "activity_interruptions",
          "rule_refs": [
            "PRIV007"
          ],
          "threshold_source": "Мягкая цель брифа или дизайн-профиля",
          "expected_value": null,
          "observed_value": null,
          "result": null,
          "status": "specification_only",
          "severity": "soft",
          "weight": null,
          "target_value": null,
          "promotion_to_hard_requirement_id": null
        }
      ],
      "missing_inputs": [
        {
          "field_path": "brief.daily_life.sleep",
          "reason": "Нужно подтвердить сам конфликт режимов сна.",
          "value": null,
          "blocking_scope": "scenario"
        },
        {
          "field_path": "brief.household.members",
          "reason": "Нужно назначить стороны кровати и пользователей.",
          "value": null,
          "blocking_scope": "scenario"
        },
        {
          "field_path": "brief.site_and_light.lighting_scenarios",
          "reason": "Нужны управляемые световые режимы.",
          "value": null,
          "blocking_scope": "lighting"
        }
      ],
      "execution_results": null
    },
    {
      "scenario_id": "SCN003",
      "core_rule_id": "SCN003",
      "title": "Семейный завтрак",
      "description": "Готовка, холодильник, кофе и посадка происходят одновременно.",
      "status": "specification_only",
      "enabled": null,
      "mandatory": null,
      "activation_condition": "Подтверждены совместный завтрак и пересечение готовки, напитков и посадки.",
      "frequency": {
        "value": null,
        "period": null,
        "seasonality": null,
        "source_id": null
      },
      "priority": null,
      "actors": [
        {
          "role_id": "cook",
          "description": "Готовящий человек",
          "person_ids": null,
          "count": null,
          "binding_source": "brief.daily_life.cooking_activities",
          "body_or_device_model_ref": null,
          "carried_objects": null,
          "binding_verified": null
        },
        {
          "role_id": "breakfast_user",
          "description": "Берущий продукты/напиток и садящийся",
          "person_ids": null,
          "count": null,
          "binding_source": "brief.household.members",
          "body_or_device_model_ref": null,
          "carried_objects": null,
          "binding_verified": null
        },
        {
          "role_id": "seated_diners",
          "description": "Сидящие участники",
          "person_ids": null,
          "count": null,
          "binding_source": "brief.capacity_targets.daily_dining_seats",
          "body_or_device_model_ref": null,
          "carried_objects": null,
          "binding_verified": null
        }
      ],
      "tasks": [
        {
          "task_id": "prepare",
          "actor_role": "cook",
          "action": "Подготовить и приготовить завтрак",
          "target_anchor_role": "prep_cook",
          "depends_on": [],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Сценарий включён, функция подтверждена брифом и участник привязан"
        },
        {
          "task_id": "take_food",
          "actor_role": "breakfast_user",
          "action": "Открыть холодильник и взять продукты",
          "target_anchor_role": "refrigerator",
          "depends_on": [],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Сценарий включён, функция подтверждена брифом и участник привязан"
        },
        {
          "task_id": "coffee",
          "actor_role": "breakfast_user",
          "action": "Приготовить напиток",
          "target_anchor_role": "coffee_station",
          "depends_on": [
            "take_food"
          ],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Сценарий включён, функция подтверждена брифом и участник привязан"
        },
        {
          "task_id": "sit",
          "actor_role": "breakfast_user",
          "action": "Отодвинуть стул и сесть",
          "target_anchor_role": "breakfast_seat",
          "depends_on": [
            "coffee"
          ],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Сценарий включён, функция подтверждена брифом и участник привязан"
        },
        {
          "task_id": "eat",
          "actor_role": "seated_diners",
          "action": "Сидеть за столом",
          "target_anchor_role": "breakfast_table",
          "depends_on": [],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Сценарий включён, функция подтверждена брифом и участник привязан"
        }
      ],
      "required_states": [
        {
          "state_id": "BREAKFAST",
          "description": "Посадка занята, приборы открываются только в используемой фазе",
          "object_state_requirements": {
            "dining_chairs": "occupied_or_sit_down",
            "refrigerator": "active_open_cycle",
            "cook": "working_at_active_station",
            "coffee_station": "active"
          },
          "activation_condition": "Если соответствующий объект имеется и используется в этом сценарии",
          "concrete_object_ids": null,
          "verified": null
        }
      ],
      "route_pairs": [
        {
          "route_id": "fridge_to_prep",
          "actor_role": "cook",
          "from_anchor_role": "refrigerator",
          "to_anchor_role": "prep_cook",
          "state_ids": [
            "BREAKFAST"
          ],
          "carried_object_role": "food",
          "concrete_anchor_ids": null,
          "metrics": null,
          "status": "specification_only"
        },
        {
          "route_id": "coffee_to_seat",
          "actor_role": "breakfast_user",
          "from_anchor_role": "coffee_station",
          "to_anchor_role": "breakfast_seat",
          "state_ids": [
            "BREAKFAST"
          ],
          "carried_object_role": "cup",
          "concrete_anchor_ids": null,
          "metrics": null,
          "status": "specification_only"
        }
      ],
      "concurrency": {
        "required_parallel_task_groups": [
          {
            "task_ids": [
              "prepare",
              "take_food",
              "eat"
            ],
            "condition": "При подтверждённом числе разных людей"
          },
          {
            "task_ids": [
              "prepare",
              "coffee",
              "eat"
            ],
            "condition": "Альтернативная следующая фаза; take_food и coffee одного человека не одновременны"
          }
        ],
        "mutually_exclusive_state_groups": [],
        "sequence_source": "tasks.depends_on",
        "user_confirmed": null,
        "policy": "Не объединять все открытые дверцы и все варианты состояния в один физически невозможный кадр. Одновременность связывается с конкретными участниками и фазами; последовательность проверяется отдельно.",
        "resource_policy": "Один конкретный человек и один предмет не могут одновременно занимать несовместимые позы/места. Параллельные задачи одной роли требуют разных actor_instance_id, кроме явно совместимых составных действий."
      },
      "required_checks": [
        {
          "check_id": "SCN003-R01",
          "description": "Нет недопустимых столкновений предметов и тела в требуемых совместимых состояниях.",
          "metric_id": "solid_collisions_count",
          "rule_refs": [
            "GEO004",
            "GEO005",
            "GEO014"
          ],
          "threshold_source": "Физическая совместимость; допустимые сопряжения указаны в модели",
          "expected_value": 0,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        },
        {
          "check_id": "SCN003-R02",
          "description": "Все обязательные действия и их входные/выходные маршруты доступны конкретным участникам.",
          "metric_id": "required_route_reachable",
          "rule_refs": [
            "PATH001",
            "PATH002",
            "GEO016"
          ],
          "threshold_source": "Обязательные функции выбранного сценария",
          "expected_value": true,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        },
        {
          "check_id": "SCN003-R03",
          "description": "Выполнены активные требования безопасности и ограничения паспортов; неизвестные данные остаются unknown.",
          "metric_id": "active_safety_rules",
          "rule_refs": [
            "OPT002",
            "OPT003",
            "QA006"
          ],
          "threshold_source": "Только подтверждённые применимые требования",
          "expected_value": null,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        },
        {
          "check_id": "SCN003-R04",
          "description": "Фактически используемые приборы и стулья работают с человеком перед ними.",
          "metric_id": "task_success",
          "rule_refs": [
            "GEO011",
            "GEO013"
          ],
          "threshold_source": "Рабочая геометрия и паспорт техники",
          "expected_value": true,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        }
      ],
      "comfort_checks": [
        {
          "check_id": "SCN003-C01",
          "description": "Меньше конфликтов чистого приготовления и проходов за напитками.",
          "metric_id": "route_activity_intersections",
          "rule_refs": [
            "PATH010",
            "PATH022"
          ],
          "threshold_source": "Мягкая цель брифа или дизайн-профиля",
          "expected_value": null,
          "observed_value": null,
          "result": null,
          "status": "specification_only",
          "severity": "soft",
          "weight": null,
          "target_value": null,
          "promotion_to_hard_requirement_id": null
        },
        {
          "check_id": "SCN003-C02",
          "description": "Удобны путь и промежуточная постановка еды.",
          "metric_id": "hand_carry_reachability",
          "rule_refs": [
            "PATH009"
          ],
          "threshold_source": "Мягкая цель брифа или дизайн-профиля",
          "expected_value": null,
          "observed_value": null,
          "result": null,
          "status": "specification_only",
          "severity": "soft",
          "weight": null,
          "target_value": null,
          "promotion_to_hard_requirement_id": null
        }
      ],
      "missing_inputs": [
        {
          "field_path": "brief.daily_life.cooking_activities",
          "reason": "Нужны действия и число одновременно готовящих.",
          "value": null,
          "blocking_scope": "scenario"
        },
        {
          "field_path": "brief.capacity_targets.daily_dining_seats",
          "reason": "Нужна повседневная вместимость.",
          "value": null,
          "blocking_scope": "capacity"
        },
        {
          "field_path": "brief.engineering.points_and_equipment",
          "reason": "Нужны модели приборов и их открывание.",
          "value": null,
          "blocking_scope": "geometry"
        }
      ],
      "execution_results": null
    },
    {
      "scenario_id": "SCN004",
      "core_rule_id": "SCN004",
      "title": "Большой прием",
      "description": "Стол раскрыт, все расчетные места заняты, еда подается, часть гостей идет к санузлу.",
      "status": "specification_only",
      "enabled": null,
      "mandatory": null,
      "activation_condition": "Пользователь подтвердил регулярный или редкий приём с заданной вместимостью.",
      "frequency": {
        "value": null,
        "period": null,
        "seasonality": null,
        "source_id": null
      },
      "priority": null,
      "actors": [
        {
          "role_id": "diners",
          "description": "Сидящие гости и семья",
          "person_ids": null,
          "count": null,
          "binding_source": "brief.daily_life.guest_events",
          "body_or_device_model_ref": null,
          "carried_objects": null,
          "binding_verified": null
        },
        {
          "role_id": "server",
          "description": "Подающий еду",
          "person_ids": null,
          "count": null,
          "binding_source": "brief.daily_life.guest_events",
          "body_or_device_model_ref": null,
          "carried_objects": null,
          "binding_verified": null
        },
        {
          "role_id": "walking_guest",
          "description": "Гость, идущий в санузел или на террасу",
          "person_ids": null,
          "count": null,
          "binding_source": "brief.daily_life.guest_events",
          "body_or_device_model_ref": null,
          "carried_objects": null,
          "binding_verified": null
        }
      ],
      "tasks": [
        {
          "task_id": "transform",
          "actor_role": "server",
          "action": "Разложить стол и поставить временные стулья",
          "target_anchor_role": "dining_table",
          "depends_on": [],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Сценарий включён, функция подтверждена брифом и участник привязан"
        },
        {
          "task_id": "seat",
          "actor_role": "diners",
          "action": "Занять согласованные места",
          "target_anchor_role": "dining_seats",
          "depends_on": [
            "transform"
          ],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Сценарий включён, функция подтверждена брифом и участник привязан"
        },
        {
          "task_id": "dine",
          "actor_role": "diners",
          "action": "Сидеть за столом и принимать еду; уходящий гость исключается из этого множества",
          "target_anchor_role": "dining_seats",
          "depends_on": [
            "seat"
          ],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Сценарий включён, функция подтверждена брифом и участник привязан"
        },
        {
          "task_id": "serve",
          "actor_role": "server",
          "action": "Донести еду к столу",
          "target_anchor_role": "dining_table",
          "depends_on": [
            "transform"
          ],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Сценарий включён, функция подтверждена брифом и участник привязан"
        },
        {
          "task_id": "visit_wc",
          "actor_role": "walking_guest",
          "action": "Выйти от стола и дойти к санузлу",
          "target_anchor_role": "guest_wc",
          "depends_on": [
            "seat"
          ],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Сценарий включён, функция подтверждена брифом и участник привязан"
        }
      ],
      "required_states": [
        {
          "state_id": "GUESTS",
          "description": "Стол разложен, места заняты, временно убранные вещи имеют место",
          "object_state_requirements": {
            "table": "approved_extended_state",
            "chairs": "occupied_except_departing_guest",
            "removed_furniture": "in_confirmed_storage",
            "service_staging": "available"
          },
          "activation_condition": "Если соответствующий объект имеется и используется в этом сценарии",
          "concrete_object_ids": null,
          "verified": null
        }
      ],
      "route_pairs": [
        {
          "route_id": "kitchen_to_table",
          "actor_role": "server",
          "from_anchor_role": "food_service",
          "to_anchor_role": "dining_table",
          "state_ids": [
            "GUESTS"
          ],
          "carried_object_role": "tray",
          "concrete_anchor_ids": null,
          "metrics": null,
          "status": "specification_only"
        },
        {
          "route_id": "seat_to_wc",
          "actor_role": "walking_guest",
          "from_anchor_role": "dining_seat",
          "to_anchor_role": "guest_wc",
          "state_ids": [
            "GUESTS"
          ],
          "carried_object_role": null,
          "concrete_anchor_ids": null,
          "metrics": null,
          "status": "specification_only"
        }
      ],
      "concurrency": {
        "required_parallel_task_groups": [
          {
            "task_ids": [
              "dine",
              "serve",
              "visit_wc"
            ],
            "condition": "Разные люди: сидящие, подающий и уходящий гость; один человек не остаётся фантомно сидеть после выхода"
          }
        ],
        "mutually_exclusive_state_groups": [],
        "sequence_source": "tasks.depends_on",
        "user_confirmed": null,
        "policy": "Не объединять все открытые дверцы и все варианты состояния в один физически невозможный кадр. Одновременность связывается с конкретными участниками и фазами; последовательность проверяется отдельно.",
        "resource_policy": "Один конкретный человек и один предмет не могут одновременно занимать несовместимые позы/места. Параллельные задачи одной роли требуют разных actor_instance_id, кроме явно совместимых составных действий."
      },
      "required_checks": [
        {
          "check_id": "SCN004-R01",
          "description": "Нет недопустимых столкновений предметов и тела в требуемых совместимых состояниях.",
          "metric_id": "solid_collisions_count",
          "rule_refs": [
            "GEO004",
            "GEO005",
            "GEO014"
          ],
          "threshold_source": "Физическая совместимость; допустимые сопряжения указаны в модели",
          "expected_value": 0,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        },
        {
          "check_id": "SCN004-R02",
          "description": "Все обязательные действия и их входные/выходные маршруты доступны конкретным участникам.",
          "metric_id": "required_route_reachable",
          "rule_refs": [
            "PATH001",
            "PATH002",
            "GEO016"
          ],
          "threshold_source": "Обязательные функции выбранного сценария",
          "expected_value": true,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        },
        {
          "check_id": "SCN004-R03",
          "description": "Выполнены активные требования безопасности и ограничения паспортов; неизвестные данные остаются unknown.",
          "metric_id": "active_safety_rules",
          "rule_refs": [
            "OPT002",
            "OPT003",
            "QA006"
          ],
          "threshold_source": "Только подтверждённые применимые требования",
          "expected_value": null,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        },
        {
          "check_id": "SCN004-R04",
          "description": "Каждое заявленное место пригодно, а не только обозначено стулом.",
          "metric_id": "required_capacity",
          "rule_refs": [
            "QA010"
          ],
          "threshold_source": "brief.daily_life.guest_events.seated_at_once",
          "expected_value": null,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        },
        {
          "check_id": "SCN004-R05",
          "description": "Временно убранная мебель действительно помещается в предусмотренное хранение.",
          "metric_id": "storage_capacity_match",
          "rule_refs": [
            "SCN004"
          ],
          "threshold_source": "Инвентарь перехода между состояниями",
          "expected_value": true,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        }
      ],
      "comfort_checks": [
        {
          "check_id": "SCN004-C01",
          "description": "Подача не пересекает основное общение и частный маршрут семьи.",
          "metric_id": "route_activity_intersections",
          "rule_refs": [
            "PATH008",
            "PATH018"
          ],
          "threshold_source": "Мягкая цель брифа или дизайн-профиля",
          "expected_value": null,
          "observed_value": null,
          "result": null,
          "status": "specification_only",
          "severity": "soft",
          "weight": null,
          "target_value": null,
          "promotion_to_hard_requirement_id": null
        },
        {
          "check_id": "SCN004-C02",
          "description": "После занятия мест сохраняется целевая ширина прохода.",
          "metric_id": "minimum_clear_width",
          "rule_refs": [
            "PATH007"
          ],
          "threshold_source": "Мягкая цель брифа или дизайн-профиля",
          "expected_value": null,
          "observed_value": null,
          "result": null,
          "status": "specification_only",
          "severity": "soft",
          "weight": null,
          "target_value": null,
          "promotion_to_hard_requirement_id": null
        }
      ],
      "missing_inputs": [
        {
          "field_path": "brief.daily_life.guest_events",
          "reason": "Нужны вместимость, формат подачи и частота.",
          "value": null,
          "blocking_scope": "scenario"
        },
        {
          "field_path": "brief.furniture_and_procurement.existing_items",
          "reason": "Нужны состояния стола и стульев.",
          "value": null,
          "blocking_scope": "geometry"
        },
        {
          "field_path": "brief.storage_inventory.items",
          "reason": "Нужно учесть временно убранные предметы.",
          "value": null,
          "blocking_scope": "capacity"
        }
      ],
      "execution_results": null
    },
    {
      "scenario_id": "SCN005",
      "core_rule_id": "SCN005",
      "title": "Гости с ночевкой",
      "description": "Диван или гостевая кровать разложены, чемодан открыт, гость идет в ванную.",
      "status": "specification_only",
      "enabled": null,
      "mandatory": null,
      "activation_condition": "Ночёвка гостей подтверждена; применяются выбранные постоянные или трансформируемые спальные места.",
      "frequency": {
        "value": null,
        "period": null,
        "seasonality": null,
        "source_id": null
      },
      "priority": null,
      "actors": [
        {
          "role_id": "overnight_guest",
          "description": "Гость с багажом",
          "person_ids": null,
          "count": null,
          "binding_source": "brief.daily_life.guest_events",
          "body_or_device_model_ref": null,
          "carried_objects": null,
          "binding_verified": null
        },
        {
          "role_id": "resident",
          "description": "Житель, продолжающий пользоваться домом",
          "person_ids": null,
          "count": null,
          "binding_source": "brief.household.members",
          "body_or_device_model_ref": null,
          "carried_objects": null,
          "binding_verified": null
        }
      ],
      "tasks": [
        {
          "task_id": "unfold",
          "actor_role": "overnight_guest",
          "action": "Подготовить спальное место",
          "target_anchor_role": "guest_bed",
          "depends_on": [],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Сценарий включён, функция подтверждена брифом и участник привязан"
        },
        {
          "task_id": "open_luggage",
          "actor_role": "overnight_guest",
          "action": "Разместить и открыть багаж",
          "target_anchor_role": "luggage_staging",
          "depends_on": [],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Сценарий включён, функция подтверждена брифом и участник привязан"
        },
        {
          "task_id": "sleep",
          "actor_role": "overnight_guest",
          "action": "Использовать постель",
          "target_anchor_role": "guest_bed",
          "depends_on": [
            "unfold"
          ],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Сценарий включён, функция подтверждена брифом и участник привязан"
        },
        {
          "task_id": "night_wc",
          "actor_role": "overnight_guest",
          "action": "Встать и дойти до санузла",
          "target_anchor_role": "guest_bathroom",
          "depends_on": [
            "sleep"
          ],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Сценарий включён, функция подтверждена брифом и участник привязан"
        },
        {
          "task_id": "resident_route",
          "actor_role": "resident",
          "action": "Пройти по обычному ночному маршруту",
          "target_anchor_role": "resident_bathroom",
          "depends_on": [],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Сценарий включён, функция подтверждена брифом и участник привязан"
        }
      ],
      "required_states": [
        {
          "state_id": "GUEST_NIGHT",
          "description": "Спальное место разложено и багаж занимает реальный объём",
          "object_state_requirements": {
            "guest_bed": "sleep_state",
            "luggage": "open_if_confirmed",
            "curtains": "night_state",
            "night_lights": "selected"
          },
          "activation_condition": "Если соответствующий объект имеется и используется в этом сценарии",
          "concrete_object_ids": null,
          "verified": null
        }
      ],
      "route_pairs": [
        {
          "route_id": "guest_bed_to_wc",
          "actor_role": "overnight_guest",
          "from_anchor_role": "guest_bed_exit",
          "to_anchor_role": "guest_bathroom",
          "state_ids": [
            "GUEST_NIGHT"
          ],
          "carried_object_role": null,
          "concrete_anchor_ids": null,
          "metrics": null,
          "status": "specification_only"
        },
        {
          "route_id": "resident_night",
          "actor_role": "resident",
          "from_anchor_role": "resident_bed_exit",
          "to_anchor_role": "resident_bathroom",
          "state_ids": [
            "GUEST_NIGHT"
          ],
          "carried_object_role": null,
          "concrete_anchor_ids": null,
          "metrics": null,
          "status": "specification_only"
        }
      ],
      "concurrency": {
        "required_parallel_task_groups": [
          {
            "task_ids": [
              "night_wc",
              "resident_route"
            ],
            "condition": "Если одновременные ночные маршруты включены в бриф"
          }
        ],
        "mutually_exclusive_state_groups": [],
        "sequence_source": "tasks.depends_on",
        "user_confirmed": null,
        "policy": "Не объединять все открытые дверцы и все варианты состояния в один физически невозможный кадр. Одновременность связывается с конкретными участниками и фазами; последовательность проверяется отдельно.",
        "resource_policy": "Один конкретный человек и один предмет не могут одновременно занимать несовместимые позы/места. Параллельные задачи одной роли требуют разных actor_instance_id, кроме явно совместимых составных действий."
      },
      "required_checks": [
        {
          "check_id": "SCN005-R01",
          "description": "Нет недопустимых столкновений предметов и тела в требуемых совместимых состояниях.",
          "metric_id": "solid_collisions_count",
          "rule_refs": [
            "GEO004",
            "GEO005",
            "GEO014"
          ],
          "threshold_source": "Физическая совместимость; допустимые сопряжения указаны в модели",
          "expected_value": 0,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        },
        {
          "check_id": "SCN005-R02",
          "description": "Все обязательные действия и их входные/выходные маршруты доступны конкретным участникам.",
          "metric_id": "required_route_reachable",
          "rule_refs": [
            "PATH001",
            "PATH002",
            "GEO016"
          ],
          "threshold_source": "Обязательные функции выбранного сценария",
          "expected_value": true,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        },
        {
          "check_id": "SCN005-R03",
          "description": "Выполнены активные требования безопасности и ограничения паспортов; неизвестные данные остаются unknown.",
          "metric_id": "active_safety_rules",
          "rule_refs": [
            "OPT002",
            "OPT003",
            "QA006"
          ],
          "threshold_source": "Только подтверждённые применимые требования",
          "expected_value": null,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        },
        {
          "check_id": "SCN005-R04",
          "description": "Разложенная мебель и багаж не делают постель или выход недоступными.",
          "metric_id": "task_success",
          "rule_refs": [
            "GEO012",
            "GEO016"
          ],
          "threshold_source": "Функциональная выполнимость",
          "expected_value": true,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        }
      ],
      "comfort_checks": [
        {
          "check_id": "SCN005-C01",
          "description": "Ночной путь гостя сохраняет приватность семейной зоны.",
          "metric_id": "private_view_exposure",
          "rule_refs": [
            "PRIV001",
            "PATH008"
          ],
          "threshold_source": "Мягкая цель брифа или дизайн-профиля",
          "expected_value": null,
          "observed_value": null,
          "result": null,
          "status": "specification_only",
          "severity": "soft",
          "weight": null,
          "target_value": null,
          "promotion_to_hard_requirement_id": null
        },
        {
          "check_id": "SCN005-C02",
          "description": "Багаж доступен без перекладывания вещей на постель.",
          "metric_id": "task_success",
          "rule_refs": [
            "SCN005"
          ],
          "threshold_source": "Мягкая цель брифа или дизайн-профиля",
          "expected_value": null,
          "observed_value": null,
          "result": null,
          "status": "specification_only",
          "severity": "soft",
          "weight": null,
          "target_value": null,
          "promotion_to_hard_requirement_id": null
        }
      ],
      "missing_inputs": [
        {
          "field_path": "brief.daily_life.guest_events",
          "reason": "Нужны число ночующих и условия багажного сценария.",
          "value": null,
          "blocking_scope": "scenario"
        },
        {
          "field_path": "brief.furniture_and_procurement.existing_items",
          "reason": "Нужны раскрытые размеры спального места.",
          "value": null,
          "blocking_scope": "geometry"
        }
      ],
      "execution_results": null
    },
    {
      "scenario_id": "SCN006",
      "core_rule_id": "SCN006",
      "title": "Вечерний фильм",
      "description": "Все регулярные зрители сидят, кто-то проходит за водой, шторы закрыты.",
      "status": "specification_only",
      "enabled": null,
      "mandatory": null,
      "activation_condition": "Подтверждены просмотр фильма, состав зрителей и необходимость прохода во время просмотра.",
      "frequency": {
        "value": null,
        "period": null,
        "seasonality": null,
        "source_id": null
      },
      "priority": null,
      "actors": [
        {
          "role_id": "viewers",
          "description": "Сидящие зрители",
          "person_ids": null,
          "count": null,
          "binding_source": "brief.capacity_targets.movie_seats",
          "body_or_device_model_ref": null,
          "carried_objects": null,
          "binding_verified": null
        },
        {
          "role_id": "walking_viewer",
          "description": "Выходящий за водой зритель",
          "person_ids": null,
          "count": null,
          "binding_source": "brief.daily_life.leisure",
          "body_or_device_model_ref": null,
          "carried_objects": null,
          "binding_verified": null
        }
      ],
      "tasks": [
        {
          "task_id": "watch",
          "actor_role": "viewers",
          "action": "Смотреть экран",
          "target_anchor_role": "screen",
          "depends_on": [],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Сценарий включён, функция подтверждена брифом и участник привязан"
        },
        {
          "task_id": "get_up",
          "actor_role": "walking_viewer",
          "action": "Встать со своего места",
          "target_anchor_role": "media_seat",
          "depends_on": [],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Сценарий включён, функция подтверждена брифом и участник привязан"
        },
        {
          "task_id": "fetch_water",
          "actor_role": "walking_viewer",
          "action": "Дойти за водой",
          "target_anchor_role": "water_station",
          "depends_on": [
            "get_up"
          ],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Сценарий включён, функция подтверждена брифом и участник привязан"
        },
        {
          "task_id": "return",
          "actor_role": "walking_viewer",
          "action": "Вернуться на место",
          "target_anchor_role": "media_seat",
          "depends_on": [
            "fetch_water"
          ],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Сценарий включён, функция подтверждена брифом и участник привязан"
        }
      ],
      "required_states": [
        {
          "state_id": "MOVIE",
          "description": "Посадка и шторы в используемом кино-режиме",
          "object_state_requirements": {
            "seating": "occupied_except_walking_user",
            "recliners": "selected_recline_if_present",
            "curtains": "selected_closed_state",
            "lighting": "movie_mode"
          },
          "activation_condition": "Если соответствующий объект имеется и используется в этом сценарии",
          "concrete_object_ids": null,
          "verified": null
        }
      ],
      "route_pairs": [
        {
          "route_id": "seat_to_water",
          "actor_role": "walking_viewer",
          "from_anchor_role": "media_seat_exit",
          "to_anchor_role": "water_station",
          "state_ids": [
            "MOVIE"
          ],
          "carried_object_role": null,
          "concrete_anchor_ids": null,
          "metrics": null,
          "status": "specification_only"
        },
        {
          "route_id": "water_to_seat",
          "actor_role": "walking_viewer",
          "from_anchor_role": "water_station",
          "to_anchor_role": "media_seat",
          "state_ids": [
            "MOVIE"
          ],
          "carried_object_role": "cup",
          "concrete_anchor_ids": null,
          "metrics": null,
          "status": "specification_only"
        }
      ],
      "concurrency": {
        "required_parallel_task_groups": [
          {
            "task_ids": [
              "watch",
              "fetch_water"
            ],
            "condition": "Если просмотр не прерывается уходом участника"
          }
        ],
        "mutually_exclusive_state_groups": [],
        "sequence_source": "tasks.depends_on",
        "user_confirmed": null,
        "policy": "Не объединять все открытые дверцы и все варианты состояния в один физически невозможный кадр. Одновременность связывается с конкретными участниками и фазами; последовательность проверяется отдельно.",
        "resource_policy": "Один конкретный человек и один предмет не могут одновременно занимать несовместимые позы/места. Параллельные задачи одной роли требуют разных actor_instance_id, кроме явно совместимых составных действий."
      },
      "required_checks": [
        {
          "check_id": "SCN006-R01",
          "description": "Нет недопустимых столкновений предметов и тела в требуемых совместимых состояниях.",
          "metric_id": "solid_collisions_count",
          "rule_refs": [
            "GEO004",
            "GEO005",
            "GEO014"
          ],
          "threshold_source": "Физическая совместимость; допустимые сопряжения указаны в модели",
          "expected_value": 0,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        },
        {
          "check_id": "SCN006-R02",
          "description": "Все обязательные действия и их входные/выходные маршруты доступны конкретным участникам.",
          "metric_id": "required_route_reachable",
          "rule_refs": [
            "PATH001",
            "PATH002",
            "GEO016"
          ],
          "threshold_source": "Обязательные функции выбранного сценария",
          "expected_value": true,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        },
        {
          "check_id": "SCN006-R03",
          "description": "Выполнены активные требования безопасности и ограничения паспортов; неизвестные данные остаются unknown.",
          "metric_id": "active_safety_rules",
          "rule_refs": [
            "OPT002",
            "OPT003",
            "QA006"
          ],
          "threshold_source": "Только подтверждённые применимые требования",
          "expected_value": null,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        },
        {
          "check_id": "SCN006-R04",
          "description": "Заявленное число мест имеет физический доступ и не блокирует управление.",
          "metric_id": "required_capacity",
          "rule_refs": [
            "QA010",
            "LGT015"
          ],
          "threshold_source": "brief.capacity_targets.movie_seats",
          "expected_value": null,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        }
      ],
      "comfort_checks": [
        {
          "check_id": "SCN006-C01",
          "description": "Все основные зрители видят экран без постоянных препятствий.",
          "metric_id": "view_target_visibility",
          "rule_refs": [
            "VIS003"
          ],
          "threshold_source": "Мягкая цель брифа или дизайн-профиля",
          "expected_value": null,
          "observed_value": null,
          "result": null,
          "status": "specification_only",
          "severity": "soft",
          "weight": null,
          "target_value": null,
          "promotion_to_hard_requirement_id": null
        },
        {
          "check_id": "SCN006-C02",
          "description": "Низки блики с учётом реальных штор и положения глаз.",
          "metric_id": "glare_risk",
          "rule_refs": [
            "LGT006",
            "LGT020"
          ],
          "threshold_source": "Мягкая цель брифа или дизайн-профиля",
          "expected_value": null,
          "observed_value": null,
          "result": null,
          "status": "specification_only",
          "severity": "soft",
          "weight": null,
          "target_value": null,
          "promotion_to_hard_requirement_id": null
        },
        {
          "check_id": "SCN006-C03",
          "description": "Проходящий человек редко пересекает обзор зрителей.",
          "metric_id": "route_activity_intersections",
          "rule_refs": [
            "PATH019"
          ],
          "threshold_source": "Мягкая цель брифа или дизайн-профиля",
          "expected_value": null,
          "observed_value": null,
          "result": null,
          "status": "specification_only",
          "severity": "soft",
          "weight": null,
          "target_value": null,
          "promotion_to_hard_requirement_id": null
        }
      ],
      "missing_inputs": [
        {
          "field_path": "brief.capacity_targets.movie_seats",
          "reason": "Нужно количество и расположение зрителей.",
          "value": null,
          "blocking_scope": "capacity"
        },
        {
          "field_path": "brief.furniture_and_procurement.existing_items",
          "reason": "Нужны экран, посадка и режимы реклайнеров.",
          "value": null,
          "blocking_scope": "geometry"
        },
        {
          "field_path": "brief.site_and_light.lighting_scenarios",
          "reason": "Нужны свет и шторы для оценки бликов.",
          "value": null,
          "blocking_scope": "lighting"
        }
      ],
      "execution_results": null
    },
    {
      "scenario_id": "SCN007",
      "core_rule_id": "SCN007",
      "title": "Разговор без ТВ",
      "description": "Разговорная группа вмещает согласованное число людей и позволяет выбранный формат общения.",
      "status": "specification_only",
      "enabled": null,
      "mandatory": null,
      "activation_condition": "Подтверждены разговорная группа и согласованная вместимость.",
      "frequency": {
        "value": null,
        "period": null,
        "seasonality": null,
        "source_id": null
      },
      "priority": null,
      "actors": [
        {
          "role_id": "participants",
          "description": "Участники разговора",
          "person_ids": null,
          "count": null,
          "binding_source": "brief.capacity_targets.conversation_seats",
          "body_or_device_model_ref": null,
          "carried_objects": null,
          "binding_verified": null
        }
      ],
      "tasks": [
        {
          "task_id": "approach",
          "actor_role": "participants",
          "action": "Подойти к своему месту",
          "target_anchor_role": "conversation_seats",
          "depends_on": [],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Сценарий включён, функция подтверждена брифом и участник привязан"
        },
        {
          "task_id": "sit",
          "actor_role": "participants",
          "action": "Сесть",
          "target_anchor_role": "conversation_seats",
          "depends_on": [
            "approach"
          ],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Сценарий включён, функция подтверждена брифом и участник привязан"
        },
        {
          "task_id": "talk",
          "actor_role": "participants",
          "action": "Общаться",
          "target_anchor_role": "conversation_group",
          "depends_on": [
            "sit"
          ],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Сценарий включён, функция подтверждена брифом и участник привязан"
        },
        {
          "task_id": "stand",
          "actor_role": "participants",
          "action": "Встать и выйти из группы",
          "target_anchor_role": "conversation_exit",
          "depends_on": [
            "talk"
          ],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Сценарий включён, функция подтверждена брифом и участник привязан"
        }
      ],
      "required_states": [
        {
          "state_id": "CONVERSATION",
          "description": "Все согласованные места заняты",
          "object_state_requirements": {
            "conversation_seats": "occupied",
            "coffee_table": "normal_state",
            "side_tables": "normal_state"
          },
          "activation_condition": "Если соответствующий объект имеется и используется в этом сценарии",
          "concrete_object_ids": null,
          "verified": null
        }
      ],
      "route_pairs": [
        {
          "route_id": "entry_to_conversation",
          "actor_role": "participants",
          "from_anchor_role": "living_entry",
          "to_anchor_role": "conversation_seats",
          "state_ids": [
            "CONVERSATION"
          ],
          "carried_object_role": null,
          "concrete_anchor_ids": null,
          "metrics": null,
          "status": "specification_only"
        },
        {
          "route_id": "conversation_to_exit",
          "actor_role": "participants",
          "from_anchor_role": "conversation_seats",
          "to_anchor_role": "conversation_exit",
          "state_ids": [
            "CONVERSATION"
          ],
          "carried_object_role": null,
          "concrete_anchor_ids": null,
          "metrics": null,
          "status": "specification_only"
        }
      ],
      "concurrency": {
        "required_parallel_task_groups": [
          {
            "task_ids": [
              "talk"
            ],
            "condition": "Множество участников; не требуется фронтальная ориентация каждой пары одновременно"
          }
        ],
        "mutually_exclusive_state_groups": [],
        "sequence_source": "tasks.depends_on",
        "user_confirmed": null,
        "policy": "Не объединять все открытые дверцы и все варианты состояния в один физически невозможный кадр. Одновременность связывается с конкретными участниками и фазами; последовательность проверяется отдельно.",
        "resource_policy": "Один конкретный человек и один предмет не могут одновременно занимать несовместимые позы/места. Параллельные задачи одной роли требуют разных actor_instance_id, кроме явно совместимых составных действий."
      },
      "required_checks": [
        {
          "check_id": "SCN007-R01",
          "description": "Нет недопустимых столкновений предметов и тела в требуемых совместимых состояниях.",
          "metric_id": "solid_collisions_count",
          "rule_refs": [
            "GEO004",
            "GEO005",
            "GEO014"
          ],
          "threshold_source": "Физическая совместимость; допустимые сопряжения указаны в модели",
          "expected_value": 0,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        },
        {
          "check_id": "SCN007-R02",
          "description": "Все обязательные действия и их входные/выходные маршруты доступны конкретным участникам.",
          "metric_id": "required_route_reachable",
          "rule_refs": [
            "PATH001",
            "PATH002",
            "GEO016"
          ],
          "threshold_source": "Обязательные функции выбранного сценария",
          "expected_value": true,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        },
        {
          "check_id": "SCN007-R03",
          "description": "Выполнены активные требования безопасности и ограничения паспортов; неизвестные данные остаются unknown.",
          "metric_id": "active_safety_rules",
          "rule_refs": [
            "OPT002",
            "OPT003",
            "QA006"
          ],
          "threshold_source": "Только подтверждённые применимые требования",
          "expected_value": null,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        },
        {
          "check_id": "SCN007-R04",
          "description": "Каждое согласованное место доступно для посадки и вставания.",
          "metric_id": "required_capacity",
          "rule_refs": [
            "QA010"
          ],
          "threshold_source": "brief.capacity_targets.conversation_seats",
          "expected_value": null,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        }
      ],
      "comfort_checks": [
        {
          "check_id": "SCN007-C01",
          "description": "Удобны взаимная видимость и повороты корпуса.",
          "metric_id": "view_target_visibility",
          "rule_refs": [
            "VIS001",
            "VIS002"
          ],
          "threshold_source": "Мягкая цель брифа или дизайн-профиля",
          "expected_value": null,
          "observed_value": null,
          "result": null,
          "status": "specification_only",
          "severity": "soft",
          "weight": null,
          "target_value": null,
          "promotion_to_hard_requirement_id": null
        },
        {
          "check_id": "SCN007-C02",
          "description": "Частый домашний транзит проходит вне основной группы.",
          "metric_id": "route_activity_intersections",
          "rule_refs": [
            "PATH018"
          ],
          "threshold_source": "Мягкая цель брифа или дизайн-профиля",
          "expected_value": null,
          "observed_value": null,
          "result": null,
          "status": "specification_only",
          "severity": "soft",
          "weight": null,
          "target_value": null,
          "promotion_to_hard_requirement_id": null
        }
      ],
      "missing_inputs": [
        {
          "field_path": "brief.capacity_targets.conversation_seats",
          "reason": "Нужна требуемая вместимость.",
          "value": null,
          "blocking_scope": "capacity"
        },
        {
          "field_path": "brief.requirements_and_preferences.room_focus_priorities",
          "reason": "Нужен формат общения и главный фокус.",
          "value": null,
          "blocking_scope": "comfort"
        }
      ],
      "execution_results": null
    },
    {
      "scenario_id": "SCN008",
      "core_rule_id": "SCN008",
      "title": "Дистанционная работа",
      "description": "Один работает за монитором, второй проходит, дверь открывается, идет звонок.",
      "status": "specification_only",
      "enabled": null,
      "mandatory": null,
      "activation_condition": "Работа дома подтверждена; видеозвонок и проход второго человека включаются отдельно по реальной привычке.",
      "frequency": {
        "value": null,
        "period": null,
        "seasonality": null,
        "source_id": null
      },
      "priority": null,
      "actors": [
        {
          "role_id": "worker",
          "description": "Работающий человек",
          "person_ids": null,
          "count": null,
          "binding_source": "brief.daily_life.work_and_study",
          "body_or_device_model_ref": null,
          "carried_objects": null,
          "binding_verified": null
        },
        {
          "role_id": "passer",
          "description": "Проходящий человек",
          "person_ids": null,
          "count": null,
          "binding_source": "brief.household.members",
          "body_or_device_model_ref": null,
          "carried_objects": null,
          "binding_verified": null
        }
      ],
      "tasks": [
        {
          "task_id": "work",
          "actor_role": "worker",
          "action": "Работать с экраном/бумагой",
          "target_anchor_role": "work_surface",
          "depends_on": [],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Сценарий включён, функция подтверждена брифом и участник привязан"
        },
        {
          "task_id": "call",
          "actor_role": "worker",
          "action": "Участвовать в видеозвонке, если он предусмотрен",
          "target_anchor_role": "camera",
          "depends_on": [],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "brief.daily_life.work_and_study.video_calls подтверждено как true"
        },
        {
          "task_id": "reposition",
          "actor_role": "worker",
          "action": "Отодвинуть кресло, встать",
          "target_anchor_role": "chair_exit",
          "depends_on": [],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Сценарий включён, функция подтверждена брифом и участник привязан"
        },
        {
          "task_id": "pass",
          "actor_role": "passer",
          "action": "Пройти и открыть дверь по обычному маршруту",
          "target_anchor_role": "room_exit",
          "depends_on": [],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Сценарий включён, функция подтверждена брифом и участник привязан"
        }
      ],
      "required_states": [
        {
          "state_id": "WORK_SEATED",
          "description": "Пользователь работает за столом",
          "object_state_requirements": {
            "desk": "used",
            "chair": "occupied",
            "monitor": "user_orientation",
            "camera": "active_only_if_selected"
          },
          "activation_condition": "Если соответствующий объект имеется и используется в этом сценарии",
          "concrete_object_ids": null,
          "verified": null
        },
        {
          "state_id": "WORK_STAND",
          "description": "Кресло отодвинуто для вставания",
          "object_state_requirements": {
            "chair": "stand_up_position",
            "worker": "standing"
          },
          "activation_condition": "Если соответствующий объект имеется и используется в этом сценарии",
          "concrete_object_ids": null,
          "verified": null
        }
      ],
      "route_pairs": [
        {
          "route_id": "work_entry",
          "actor_role": "worker",
          "from_anchor_role": "room_entry",
          "to_anchor_role": "desk",
          "state_ids": [
            "WORK_SEATED",
            "WORK_STAND"
          ],
          "carried_object_role": null,
          "concrete_anchor_ids": null,
          "metrics": null,
          "status": "specification_only"
        },
        {
          "route_id": "pass_work",
          "actor_role": "passer",
          "from_anchor_role": "room_entry",
          "to_anchor_role": "room_exit",
          "state_ids": [
            "WORK_SEATED",
            "WORK_STAND"
          ],
          "carried_object_role": null,
          "concrete_anchor_ids": null,
          "metrics": null,
          "status": "specification_only"
        }
      ],
      "concurrency": {
        "required_parallel_task_groups": [
          {
            "task_ids": [
              "work",
              "pass"
            ],
            "condition": "Если рабочее место имеет подтверждённый проход"
          },
          {
            "task_ids": [
              "call",
              "pass"
            ],
            "condition": "Только если выбран видеозвонок"
          }
        ],
        "mutually_exclusive_state_groups": [
          [
            "WORK_SEATED",
            "WORK_STAND"
          ]
        ],
        "sequence_source": "tasks.depends_on",
        "user_confirmed": null,
        "policy": "Не объединять все открытые дверцы и все варианты состояния в один физически невозможный кадр. Одновременность связывается с конкретными участниками и фазами; последовательность проверяется отдельно.",
        "resource_policy": "Один конкретный человек и один предмет не могут одновременно занимать несовместимые позы/места. Параллельные задачи одной роли требуют разных actor_instance_id, кроме явно совместимых составных действий."
      },
      "required_checks": [
        {
          "check_id": "SCN008-R01",
          "description": "Нет недопустимых столкновений предметов и тела в требуемых совместимых состояниях.",
          "metric_id": "solid_collisions_count",
          "rule_refs": [
            "GEO004",
            "GEO005",
            "GEO014"
          ],
          "threshold_source": "Физическая совместимость; допустимые сопряжения указаны в модели",
          "expected_value": 0,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        },
        {
          "check_id": "SCN008-R02",
          "description": "Все обязательные действия и их входные/выходные маршруты доступны конкретным участникам.",
          "metric_id": "required_route_reachable",
          "rule_refs": [
            "PATH001",
            "PATH002",
            "GEO016"
          ],
          "threshold_source": "Обязательные функции выбранного сценария",
          "expected_value": true,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        },
        {
          "check_id": "SCN008-R03",
          "description": "Выполнены активные требования безопасности и ограничения паспортов; неизвестные данные остаются unknown.",
          "metric_id": "active_safety_rules",
          "rule_refs": [
            "OPT002",
            "OPT003",
            "QA006"
          ],
          "threshold_source": "Только подтверждённые применимые требования",
          "expected_value": null,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        },
        {
          "check_id": "SCN008-R04",
          "description": "Рабочее кресло, входная дверь и вставание геометрически совместимы.",
          "metric_id": "swept_collisions_count",
          "rule_refs": [
            "GEO008",
            "GEO013",
            "CHVOL002"
          ],
          "threshold_source": "Физическая совместимость",
          "expected_value": 0,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        }
      ],
      "comfort_checks": [
        {
          "check_id": "SCN008-C01",
          "description": "Экран без значимых отражений, свет лица пригоден для выбранной задачи.",
          "metric_id": "glare_risk",
          "rule_refs": [
            "LGT005",
            "LGT006"
          ],
          "threshold_source": "Мягкая цель брифа или дизайн-профиля",
          "expected_value": null,
          "observed_value": null,
          "result": null,
          "status": "specification_only",
          "severity": "soft",
          "weight": null,
          "target_value": null,
          "promotion_to_hard_requirement_id": null
        },
        {
          "check_id": "SCN008-C02",
          "description": "Камера и экран не раскрывают согласованные приватные зоны.",
          "metric_id": "private_view_exposure",
          "rule_refs": [
            "PRIV005"
          ],
          "threshold_source": "Мягкая цель брифа или дизайн-профиля",
          "expected_value": null,
          "observed_value": null,
          "result": null,
          "status": "specification_only",
          "severity": "soft",
          "weight": null,
          "target_value": null,
          "promotion_to_hard_requirement_id": null
        },
        {
          "check_id": "SCN008-C03",
          "description": "Посадка соответствует антропометрии.",
          "metric_id": "observed_user_ergonomics",
          "rule_refs": [
            "IN015"
          ],
          "threshold_source": "Мягкая цель брифа или дизайн-профиля",
          "expected_value": null,
          "observed_value": null,
          "result": null,
          "status": "specification_only",
          "severity": "soft",
          "weight": null,
          "target_value": null,
          "promotion_to_hard_requirement_id": null
        }
      ],
      "missing_inputs": [
        {
          "field_path": "brief.daily_life.work_and_study",
          "reason": "Нужны техника, звонки и число работающих.",
          "value": null,
          "blocking_scope": "scenario"
        },
        {
          "field_path": "brief.household.members",
          "reason": "Нужны антропометрия и мобильность работника.",
          "value": null,
          "blocking_scope": "ergonomics"
        },
        {
          "field_path": "brief.site_and_light",
          "reason": "Нужны окна и свет для оценки бликов.",
          "value": null,
          "blocking_scope": "lighting"
        }
      ],
      "execution_results": null
    },
    {
      "scenario_id": "SCN009",
      "core_rule_id": "SCN009",
      "title": "Ребенок играет",
      "description": "На полу разложены игрушки, взрослый наблюдает и проходит.",
      "status": "specification_only",
      "enabled": null,
      "mandatory": null,
      "activation_condition": "В доме бывает ребёнок; выбран конкретный возраст, игра и необходимость наблюдения.",
      "frequency": {
        "value": null,
        "period": null,
        "seasonality": null,
        "source_id": null
      },
      "priority": null,
      "actors": [
        {
          "role_id": "child",
          "description": "Ребёнок, играющий на полу",
          "person_ids": null,
          "count": null,
          "binding_source": "brief.household.members",
          "body_or_device_model_ref": null,
          "carried_objects": null,
          "binding_verified": null
        },
        {
          "role_id": "supervisor",
          "description": "Наблюдающий взрослый",
          "person_ids": null,
          "count": null,
          "binding_source": "brief.daily_life.habits",
          "body_or_device_model_ref": null,
          "carried_objects": null,
          "binding_verified": null
        },
        {
          "role_id": "passer",
          "description": "Проходящий человек",
          "person_ids": null,
          "count": null,
          "binding_source": "brief.household.members",
          "body_or_device_model_ref": null,
          "carried_objects": null,
          "binding_verified": null
        }
      ],
      "tasks": [
        {
          "task_id": "play",
          "actor_role": "child",
          "action": "Играть с согласованным набором предметов",
          "target_anchor_role": "play_zone",
          "depends_on": [],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Сценарий включён, функция подтверждена брифом и участник привязан"
        },
        {
          "task_id": "observe",
          "actor_role": "supervisor",
          "action": "Наблюдать из используемого места",
          "target_anchor_role": "supervision_seat",
          "depends_on": [],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Сценарий включён, функция подтверждена брифом и участник привязан"
        },
        {
          "task_id": "pass",
          "actor_role": "passer",
          "action": "Пройти по домашнему маршруту",
          "target_anchor_role": "room_exit",
          "depends_on": [],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Сценарий включён, функция подтверждена брифом и участник привязан"
        },
        {
          "task_id": "tidy",
          "actor_role": "child",
          "action": "Убрать игрушки с помощью взрослого при необходимости",
          "target_anchor_role": "toy_storage",
          "depends_on": [
            "play"
          ],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Сценарий включён, функция подтверждена брифом и участник привязан"
        }
      ],
      "required_states": [
        {
          "state_id": "PLAY",
          "description": "Игрушки разложены внутри реальной зоны",
          "object_state_requirements": {
            "play_zone": "actual_toy_spread",
            "supervision_seat": "occupied",
            "adjacent_dangerous_equipment": "actual_active_state"
          },
          "activation_condition": "Если соответствующий объект имеется и используется в этом сценарии",
          "concrete_object_ids": null,
          "verified": null
        }
      ],
      "route_pairs": [
        {
          "route_id": "pass_play",
          "actor_role": "passer",
          "from_anchor_role": "room_entry",
          "to_anchor_role": "room_exit",
          "state_ids": [
            "PLAY"
          ],
          "carried_object_role": null,
          "concrete_anchor_ids": null,
          "metrics": null,
          "status": "specification_only"
        },
        {
          "route_id": "to_toys",
          "actor_role": "child",
          "from_anchor_role": "play_zone",
          "to_anchor_role": "toy_storage",
          "state_ids": [
            "PLAY"
          ],
          "carried_object_role": null,
          "concrete_anchor_ids": null,
          "metrics": null,
          "status": "specification_only"
        }
      ],
      "concurrency": {
        "required_parallel_task_groups": [
          {
            "task_ids": [
              "play",
              "observe",
              "pass"
            ],
            "condition": "По подтверждённой привычке семьи"
          }
        ],
        "mutually_exclusive_state_groups": [],
        "sequence_source": "tasks.depends_on",
        "user_confirmed": null,
        "policy": "Не объединять все открытые дверцы и все варианты состояния в один физически невозможный кадр. Одновременность связывается с конкретными участниками и фазами; последовательность проверяется отдельно.",
        "resource_policy": "Один конкретный человек и один предмет не могут одновременно занимать несовместимые позы/места. Параллельные задачи одной роли требуют разных actor_instance_id, кроме явно совместимых составных действий."
      },
      "required_checks": [
        {
          "check_id": "SCN009-R01",
          "description": "Нет недопустимых столкновений предметов и тела в требуемых совместимых состояниях.",
          "metric_id": "solid_collisions_count",
          "rule_refs": [
            "GEO004",
            "GEO005",
            "GEO014"
          ],
          "threshold_source": "Физическая совместимость; допустимые сопряжения указаны в модели",
          "expected_value": 0,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        },
        {
          "check_id": "SCN009-R02",
          "description": "Все обязательные действия и их входные/выходные маршруты доступны конкретным участникам.",
          "metric_id": "required_route_reachable",
          "rule_refs": [
            "PATH001",
            "PATH002",
            "GEO016"
          ],
          "threshold_source": "Обязательные функции выбранного сценария",
          "expected_value": true,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        },
        {
          "check_id": "SCN009-R03",
          "description": "Выполнены активные требования безопасности и ограничения паспортов; неизвестные данные остаются unknown.",
          "metric_id": "active_safety_rules",
          "rule_refs": [
            "OPT002",
            "OPT003",
            "QA006"
          ],
          "threshold_source": "Только подтверждённые применимые требования",
          "expected_value": null,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        },
        {
          "check_id": "SCN009-R04",
          "description": "Игровая зона и доступная мебель не создают путь к опасному окну, ограждению или горячей зоне.",
          "metric_id": "child_hazard_reachability",
          "rule_refs": [
            "SAFE003",
            "SAFE004",
            "SAFE005"
          ],
          "threshold_source": "Применимый детский профиль и проверка оборудования",
          "expected_value": false,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        }
      ],
      "comfort_checks": [
        {
          "check_id": "SCN009-C01",
          "description": "Взрослый видит согласованную долю игровой зоны из реального места.",
          "metric_id": "view_target_visibility",
          "rule_refs": [
            "PRIV008"
          ],
          "threshold_source": "Мягкая цель брифа или дизайн-профиля",
          "expected_value": null,
          "observed_value": null,
          "result": null,
          "status": "specification_only",
          "severity": "soft",
          "weight": null,
          "target_value": null,
          "promotion_to_hard_requirement_id": null
        },
        {
          "check_id": "SCN009-C02",
          "description": "Игрушки доступны ребёнку и удобно убираются.",
          "metric_id": "observed_user_ergonomics",
          "rule_refs": [
            "IN015"
          ],
          "threshold_source": "Мягкая цель брифа или дизайн-профиля",
          "expected_value": null,
          "observed_value": null,
          "result": null,
          "status": "specification_only",
          "severity": "soft",
          "weight": null,
          "target_value": null,
          "promotion_to_hard_requirement_id": null
        }
      ],
      "missing_inputs": [
        {
          "field_path": "brief.household.members",
          "reason": "Нужны возраст и реальные функциональные возможности ребёнка.",
          "value": null,
          "blocking_scope": "safety"
        },
        {
          "field_path": "brief.daily_life.habits",
          "reason": "Нужны игра и место наблюдения взрослого.",
          "value": null,
          "blocking_scope": "scenario"
        },
        {
          "field_path": "brief.engineering.child_safety_information",
          "reason": "Нужна подтверждённая защита окон/ограждений.",
          "value": null,
          "blocking_scope": "safety"
        }
      ],
      "execution_results": null
    },
    {
      "scenario_id": "SCN010",
      "core_rule_id": "SCN010",
      "title": "Уборка",
      "description": "Пылесос/робот, ведро или тележка используются по фактическому способу уборки.",
      "status": "specification_only",
      "enabled": null,
      "mandatory": null,
      "activation_condition": "Определён способ уборки: ручной, робот или смешанный; не все средства активируются автоматически.",
      "frequency": {
        "value": null,
        "period": null,
        "seasonality": null,
        "source_id": null
      },
      "priority": null,
      "actors": [
        {
          "role_id": "cleaner",
          "description": "Убирающий человек",
          "person_ids": null,
          "count": null,
          "binding_source": "brief.daily_life.cleaning",
          "body_or_device_model_ref": null,
          "carried_objects": null,
          "binding_verified": null
        },
        {
          "role_id": "robot",
          "description": "Робот, если используется",
          "person_ids": null,
          "count": null,
          "binding_source": "brief.daily_life.cleaning",
          "body_or_device_model_ref": null,
          "carried_objects": null,
          "binding_verified": null
        }
      ],
      "tasks": [
        {
          "task_id": "take_equipment",
          "actor_role": "cleaner",
          "action": "Взять инвентарь",
          "target_anchor_role": "cleaning_storage",
          "depends_on": [],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Сценарий включён, функция подтверждена брифом и участник привязан"
        },
        {
          "task_id": "clean",
          "actor_role": "cleaner",
          "action": "Убрать предусмотренные поверхности",
          "target_anchor_role": "cleaning_targets",
          "depends_on": [
            "take_equipment"
          ],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Сценарий включён, функция подтверждена брифом и участник привязан"
        },
        {
          "task_id": "robot_cycle",
          "actor_role": "robot",
          "action": "Выполнить уборку и вернуться к базе",
          "target_anchor_role": "robot_dock",
          "depends_on": [],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Подтверждено использование робота; его модель и рабочие зоны заданы"
        },
        {
          "task_id": "return_equipment",
          "actor_role": "cleaner",
          "action": "Убрать инвентарь",
          "target_anchor_role": "cleaning_storage",
          "depends_on": [
            "clean"
          ],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Сценарий включён, функция подтверждена брифом и участник привязан"
        }
      ],
      "required_states": [
        {
          "state_id": "MANUAL_CLEAN",
          "description": "Инвентарь и перемещаемая мебель в состоянии ручной уборки",
          "object_state_requirements": {
            "furniture": "approved_cleaning_positions",
            "cleaning_equipment": "actual_envelope"
          },
          "activation_condition": "Если соответствующий объект имеется и используется в этом сценарии",
          "concrete_object_ids": null,
          "verified": null
        },
        {
          "state_id": "ROBOT_CLEAN",
          "description": "Мебель в состоянии запуска робота",
          "object_state_requirements": {
            "robot_dock": "manufacturer_clearances",
            "floor_obstacles": "actual_state"
          },
          "activation_condition": "Если соответствующий объект имеется и используется в этом сценарии",
          "concrete_object_ids": null,
          "verified": null
        }
      ],
      "route_pairs": [
        {
          "route_id": "storage_to_clean",
          "actor_role": "cleaner",
          "from_anchor_role": "cleaning_storage",
          "to_anchor_role": "cleaning_targets",
          "state_ids": [
            "MANUAL_CLEAN"
          ],
          "carried_object_role": "cleaning_equipment",
          "concrete_anchor_ids": null,
          "metrics": null,
          "status": "specification_only"
        },
        {
          "route_id": "robot_roundtrip",
          "actor_role": "robot",
          "from_anchor_role": "robot_dock",
          "to_anchor_role": "cleaning_targets",
          "state_ids": [
            "ROBOT_CLEAN"
          ],
          "carried_object_role": null,
          "concrete_anchor_ids": null,
          "metrics": null,
          "status": "specification_only"
        }
      ],
      "concurrency": {
        "required_parallel_task_groups": [
          {
            "task_ids": [
              "clean",
              "robot_cycle"
            ],
            "condition": "Только если одновременная работа подтверждена; обычно проверяются отдельные фазы"
          }
        ],
        "mutually_exclusive_state_groups": [],
        "sequence_source": "tasks.depends_on",
        "user_confirmed": null,
        "policy": "Не объединять все открытые дверцы и все варианты состояния в один физически невозможный кадр. Одновременность связывается с конкретными участниками и фазами; последовательность проверяется отдельно.",
        "state_combination_policy": "MANUAL_CLEAN и ROBOT_CLEAN проверяются отдельно по умолчанию; совместное состояние допустимо только при подтверждённой одновременной уборке и проверке конфликтов.",
        "resource_policy": "Один конкретный человек и один предмет не могут одновременно занимать несовместимые позы/места. Параллельные задачи одной роли требуют разных actor_instance_id, кроме явно совместимых составных действий."
      },
      "required_checks": [
        {
          "check_id": "SCN010-R01",
          "description": "Нет недопустимых столкновений предметов и тела в требуемых совместимых состояниях.",
          "metric_id": "solid_collisions_count",
          "rule_refs": [
            "GEO004",
            "GEO005",
            "GEO014"
          ],
          "threshold_source": "Физическая совместимость; допустимые сопряжения указаны в модели",
          "expected_value": 0,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        },
        {
          "check_id": "SCN010-R02",
          "description": "Все обязательные действия и их входные/выходные маршруты доступны конкретным участникам.",
          "metric_id": "required_route_reachable",
          "rule_refs": [
            "PATH001",
            "PATH002",
            "GEO016"
          ],
          "threshold_source": "Обязательные функции выбранного сценария",
          "expected_value": true,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        },
        {
          "check_id": "SCN010-R03",
          "description": "Выполнены активные требования безопасности и ограничения паспортов; неизвестные данные остаются unknown.",
          "metric_id": "active_safety_rules",
          "rule_refs": [
            "OPT002",
            "OPT003",
            "QA006"
          ],
          "threshold_source": "Только подтверждённые применимые требования",
          "expected_value": null,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        },
        {
          "check_id": "SCN010-R04",
          "description": "Подтверждённый способ уборки достигает обязательных поверхностей или допускает штатное перемещение мебели.",
          "metric_id": "task_success",
          "rule_refs": [
            "SCN010"
          ],
          "threshold_source": "Согласованная стратегия уборки",
          "expected_value": true,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        },
        {
          "check_id": "SCN010-R05",
          "description": "База и рабочая зона робота соответствуют его паспорту.",
          "metric_id": "maintenance_access",
          "rule_refs": [
            "GEO014"
          ],
          "threshold_source": "Только если robot используется; инструкция конкретной модели",
          "expected_value": true,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        }
      ],
      "comfort_checks": [
        {
          "check_id": "SCN010-C01",
          "description": "Меньше недоступных поверхностей и трудных перестановок.",
          "metric_id": "cleanable_surface_fraction",
          "rule_refs": [
            "SCN010"
          ],
          "threshold_source": "Мягкая цель брифа или дизайн-профиля",
          "expected_value": null,
          "observed_value": null,
          "result": null,
          "status": "specification_only",
          "severity": "soft",
          "weight": null,
          "target_value": null,
          "promotion_to_hard_requirement_id": null
        },
        {
          "check_id": "SCN010-C02",
          "description": "Маршрут инвентаря короток и не требует неудобного переноса.",
          "metric_id": "route_length",
          "rule_refs": [
            "PATH016"
          ],
          "threshold_source": "Мягкая цель брифа или дизайн-профиля",
          "expected_value": null,
          "observed_value": null,
          "result": null,
          "status": "specification_only",
          "severity": "soft",
          "weight": null,
          "target_value": null,
          "promotion_to_hard_requirement_id": null
        }
      ],
      "missing_inputs": [
        {
          "field_path": "brief.daily_life.cleaning",
          "reason": "Нужен фактический способ уборки и модели техники.",
          "value": null,
          "blocking_scope": "scenario"
        },
        {
          "field_path": "brief.furniture_and_procurement.existing_items",
          "reason": "Нужна перемещаемость и нижние зазоры мебели.",
          "value": null,
          "blocking_scope": "geometry"
        }
      ],
      "execution_results": null
    },
    {
      "scenario_id": "SCN011",
      "core_rule_id": "SCN011",
      "title": "Стирка",
      "description": "Корзина доставлена, дверцы машин открыты, чистое белье складывают.",
      "status": "specification_only",
      "enabled": null,
      "mandatory": null,
      "activation_condition": "Стирка или обработка белья выполняется в доме; набор операций подтверждается брифом.",
      "frequency": {
        "value": null,
        "period": null,
        "seasonality": null,
        "source_id": null
      },
      "priority": null,
      "actors": [
        {
          "role_id": "laundry_user",
          "description": "Занимающийся бельём",
          "person_ids": null,
          "count": null,
          "binding_source": "brief.daily_life.laundry",
          "body_or_device_model_ref": null,
          "carried_objects": null,
          "binding_verified": null
        }
      ],
      "tasks": [
        {
          "task_id": "carry_dirty",
          "actor_role": "laundry_user",
          "action": "Доставить корзину грязного белья",
          "target_anchor_role": "sorting_zone",
          "depends_on": [],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Сценарий включён, функция подтверждена брифом и участник привязан"
        },
        {
          "task_id": "sort",
          "actor_role": "laundry_user",
          "action": "Отсортировать бельё",
          "target_anchor_role": "sorting_zone",
          "depends_on": [
            "carry_dirty"
          ],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Сценарий включён, функция подтверждена брифом и участник привязан"
        },
        {
          "task_id": "load",
          "actor_role": "laundry_user",
          "action": "Открыть и загрузить машину",
          "target_anchor_role": "washer",
          "depends_on": [
            "sort"
          ],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Сценарий включён, функция подтверждена брифом и участник привязан"
        },
        {
          "task_id": "unload",
          "actor_role": "laundry_user",
          "action": "Выгрузить чистое бельё",
          "target_anchor_role": "clean_landing",
          "depends_on": [
            "load"
          ],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Сценарий включён, функция подтверждена брифом и участник привязан"
        },
        {
          "task_id": "fold",
          "actor_role": "laundry_user",
          "action": "Сложить или подготовить бельё",
          "target_anchor_role": "folding_surface",
          "depends_on": [
            "unload"
          ],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Сценарий включён, функция подтверждена брифом и участник привязан"
        },
        {
          "task_id": "store_clean",
          "actor_role": "laundry_user",
          "action": "Доставить чистое бельё к хранению",
          "target_anchor_role": "linen_storage",
          "depends_on": [
            "fold"
          ],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Сценарий включён, функция подтверждена брифом и участник привязан"
        }
      ],
      "required_states": [
        {
          "state_id": "LOAD_WASHER",
          "description": "Загрузка машины",
          "object_state_requirements": {
            "washer": "active_door_open",
            "dirty_basket": "present",
            "operator": "loading_pose"
          },
          "activation_condition": "Если соответствующий объект имеется и используется в этом сценарии",
          "concrete_object_ids": null,
          "verified": null
        },
        {
          "state_id": "FOLD_CLEAN",
          "description": "Работа с чистым бельём",
          "object_state_requirements": {
            "folding_surface": "clear_for_actual_laundry",
            "clean_basket": "present"
          },
          "activation_condition": "Если соответствующий объект имеется и используется в этом сценарии",
          "concrete_object_ids": null,
          "verified": null
        }
      ],
      "route_pairs": [
        {
          "route_id": "dirty_to_washer",
          "actor_role": "laundry_user",
          "from_anchor_role": "dirty_collection",
          "to_anchor_role": "washer",
          "state_ids": [
            "LOAD_WASHER"
          ],
          "carried_object_role": "laundry_basket",
          "concrete_anchor_ids": null,
          "metrics": null,
          "status": "specification_only"
        },
        {
          "route_id": "fold_to_store",
          "actor_role": "laundry_user",
          "from_anchor_role": "folding_surface",
          "to_anchor_role": "linen_storage",
          "state_ids": [
            "FOLD_CLEAN"
          ],
          "carried_object_role": "clean_basket",
          "concrete_anchor_ids": null,
          "metrics": null,
          "status": "specification_only"
        }
      ],
      "concurrency": {
        "required_parallel_task_groups": [
          {
            "task_ids": [
              "load",
              "fold"
            ],
            "condition": "Только при подтверждённых разных людях или автоматической работе машины; один человек не выполняет две ручные задачи одновременно"
          }
        ],
        "mutually_exclusive_state_groups": [],
        "sequence_source": "tasks.depends_on",
        "user_confirmed": null,
        "policy": "Не объединять все открытые дверцы и все варианты состояния в один физически невозможный кадр. Одновременность связывается с конкретными участниками и фазами; последовательность проверяется отдельно.",
        "resource_policy": "Один конкретный человек и один предмет не могут одновременно занимать несовместимые позы/места. Параллельные задачи одной роли требуют разных actor_instance_id, кроме явно совместимых составных действий."
      },
      "required_checks": [
        {
          "check_id": "SCN011-R01",
          "description": "Нет недопустимых столкновений предметов и тела в требуемых совместимых состояниях.",
          "metric_id": "solid_collisions_count",
          "rule_refs": [
            "GEO004",
            "GEO005",
            "GEO014"
          ],
          "threshold_source": "Физическая совместимость; допустимые сопряжения указаны в модели",
          "expected_value": 0,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        },
        {
          "check_id": "SCN011-R02",
          "description": "Все обязательные действия и их входные/выходные маршруты доступны конкретным участникам.",
          "metric_id": "required_route_reachable",
          "rule_refs": [
            "PATH001",
            "PATH002",
            "GEO016"
          ],
          "threshold_source": "Обязательные функции выбранного сценария",
          "expected_value": true,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        },
        {
          "check_id": "SCN011-R03",
          "description": "Выполнены активные требования безопасности и ограничения паспортов; неизвестные данные остаются unknown.",
          "metric_id": "active_safety_rules",
          "rule_refs": [
            "OPT002",
            "OPT003",
            "QA006"
          ],
          "threshold_source": "Только подтверждённые применимые требования",
          "expected_value": null,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        },
        {
          "check_id": "SCN011-R04",
          "description": "Открывание, рабочая поза и извлечение белья не оставляют оператора запертым.",
          "metric_id": "task_success",
          "rule_refs": [
            "GEO011",
            "GEO016"
          ],
          "threshold_source": "Паспорт и геометрия машины",
          "expected_value": true,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        }
      ],
      "comfort_checks": [
        {
          "check_id": "SCN011-C01",
          "description": "Чистое бельё не размещается в зоне грязного сбора.",
          "metric_id": "route_activity_intersections",
          "rule_refs": [
            "PATH013"
          ],
          "threshold_source": "Мягкая цель брифа или дизайн-профиля",
          "expected_value": null,
          "observed_value": null,
          "result": null,
          "status": "specification_only",
          "severity": "soft",
          "weight": null,
          "target_value": null,
          "promotion_to_hard_requirement_id": null
        },
        {
          "check_id": "SCN011-C02",
          "description": "Корзину можно поставить и переносить без избыточных обходов.",
          "metric_id": "hand_carry_reachability",
          "rule_refs": [
            "PATH013"
          ],
          "threshold_source": "Мягкая цель брифа или дизайн-профиля",
          "expected_value": null,
          "observed_value": null,
          "result": null,
          "status": "specification_only",
          "severity": "soft",
          "weight": null,
          "target_value": null,
          "promotion_to_hard_requirement_id": null
        }
      ],
      "missing_inputs": [
        {
          "field_path": "brief.daily_life.laundry",
          "reason": "Нужны операции, число пользователей и хранение.",
          "value": null,
          "blocking_scope": "scenario"
        },
        {
          "field_path": "brief.engineering.points_and_equipment",
          "reason": "Нужны габариты и дверцы машин.",
          "value": null,
          "blocking_scope": "geometry"
        }
      ],
      "execution_results": null
    },
    {
      "scenario_id": "SCN012",
      "core_rule_id": "SCN012",
      "title": "Бассейн и душ",
      "description": "Несколько мокрых людей идут к душу и полотенцам.",
      "status": "specification_only",
      "enabled": null,
      "mandatory": null,
      "activation_condition": "Бассейн/душ используются; состав пользователей и мокрые пути подтверждены.",
      "frequency": {
        "value": null,
        "period": null,
        "seasonality": null,
        "source_id": null
      },
      "priority": null,
      "actors": [
        {
          "role_id": "wet_users",
          "description": "Пользователи бассейна и душа",
          "person_ids": null,
          "count": null,
          "binding_source": "brief.daily_life.wellness",
          "body_or_device_model_ref": null,
          "carried_objects": null,
          "binding_verified": null
        },
        {
          "role_id": "supervisor",
          "description": "Наблюдающий за детьми, если требуется",
          "person_ids": null,
          "count": null,
          "binding_source": "brief.daily_life.wellness",
          "body_or_device_model_ref": null,
          "carried_objects": null,
          "binding_verified": null
        }
      ],
      "tasks": [
        {
          "task_id": "leave_pool",
          "actor_role": "wet_users",
          "action": "Выйти из бассейна по предусмотренному выходу",
          "target_anchor_role": "pool_exit",
          "depends_on": [],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Сценарий включён, функция подтверждена брифом и участник привязан"
        },
        {
          "task_id": "take_towel",
          "actor_role": "wet_users",
          "action": "Взять полотенце",
          "target_anchor_role": "towel_storage",
          "depends_on": [
            "leave_pool"
          ],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Сценарий включён, функция подтверждена брифом и участник привязан"
        },
        {
          "task_id": "shower",
          "actor_role": "wet_users",
          "action": "Дойти в душ и воспользоваться им",
          "target_anchor_role": "shower",
          "depends_on": [
            "leave_pool"
          ],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Сценарий включён, функция подтверждена брифом и участник привязан"
        },
        {
          "task_id": "change",
          "actor_role": "wet_users",
          "action": "Переодеться",
          "target_anchor_role": "changing",
          "depends_on": [
            "shower"
          ],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Сценарий включён, функция подтверждена брифом и участник привязан"
        },
        {
          "task_id": "observe",
          "actor_role": "supervisor",
          "action": "Наблюдать за назначенной зоной",
          "target_anchor_role": "supervision_anchor",
          "depends_on": [],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Для выбранного состава пользователей подтверждена необходимость наблюдения"
        }
      ],
      "required_states": [
        {
          "state_id": "POOL_USE",
          "description": "Бассейн используется; шезлонги заняты по брифу",
          "object_state_requirements": {
            "loungers": "occupied_as_confirmed",
            "towels": "stored_at_assigned_anchor",
            "doors": "active_wet_route_cycles",
            "floor": "wet_zone_definition"
          },
          "activation_condition": "Если соответствующий объект имеется и используется в этом сценарии",
          "concrete_object_ids": null,
          "verified": null
        }
      ],
      "route_pairs": [
        {
          "route_id": "pool_to_towels",
          "actor_role": "wet_users",
          "from_anchor_role": "pool_exit",
          "to_anchor_role": "towel_storage",
          "state_ids": [
            "POOL_USE"
          ],
          "carried_object_role": null,
          "concrete_anchor_ids": null,
          "metrics": null,
          "status": "specification_only"
        },
        {
          "route_id": "pool_to_shower",
          "actor_role": "wet_users",
          "from_anchor_role": "pool_exit",
          "to_anchor_role": "shower",
          "state_ids": [
            "POOL_USE"
          ],
          "carried_object_role": null,
          "concrete_anchor_ids": null,
          "metrics": null,
          "status": "specification_only"
        },
        {
          "route_id": "shower_to_change",
          "actor_role": "wet_users",
          "from_anchor_role": "shower",
          "to_anchor_role": "changing",
          "state_ids": [
            "POOL_USE"
          ],
          "carried_object_role": null,
          "concrete_anchor_ids": null,
          "metrics": null,
          "status": "specification_only"
        }
      ],
      "concurrency": {
        "required_parallel_task_groups": [
          {
            "task_ids": [
              "leave_pool",
              "shower",
              "observe"
            ],
            "condition": "Для разных пользователей и подтверждённого наблюдения",
            "distinct_actor_instances": {
              "task_ids": [
                "leave_pool",
                "shower"
              ],
              "required": true,
              "reason": "Разные пользователи: один выходит из бассейна, другой уже принимает душ. Для одного человека действует последовательность."
            }
          }
        ],
        "mutually_exclusive_state_groups": [],
        "sequence_source": "tasks.depends_on",
        "user_confirmed": null,
        "policy": "Не объединять все открытые дверцы и все варианты состояния в один физически невозможный кадр. Одновременность связывается с конкретными участниками и фазами; последовательность проверяется отдельно.",
        "resource_policy": "Один конкретный человек и один предмет не могут одновременно занимать несовместимые позы/места. Параллельные задачи одной роли требуют разных actor_instance_id, кроме явно совместимых составных действий."
      },
      "required_checks": [
        {
          "check_id": "SCN012-R01",
          "description": "Нет недопустимых столкновений предметов и тела в требуемых совместимых состояниях.",
          "metric_id": "solid_collisions_count",
          "rule_refs": [
            "GEO004",
            "GEO005",
            "GEO014"
          ],
          "threshold_source": "Физическая совместимость; допустимые сопряжения указаны в модели",
          "expected_value": 0,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        },
        {
          "check_id": "SCN012-R02",
          "description": "Все обязательные действия и их входные/выходные маршруты доступны конкретным участникам.",
          "metric_id": "required_route_reachable",
          "rule_refs": [
            "PATH001",
            "PATH002",
            "GEO016"
          ],
          "threshold_source": "Обязательные функции выбранного сценария",
          "expected_value": true,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        },
        {
          "check_id": "SCN012-R03",
          "description": "Выполнены активные требования безопасности и ограничения паспортов; неизвестные данные остаются unknown.",
          "metric_id": "active_safety_rules",
          "rule_refs": [
            "OPT002",
            "OPT003",
            "QA006"
          ],
          "threshold_source": "Только подтверждённые применимые требования",
          "expected_value": null,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        },
        {
          "check_id": "SCN012-R04",
          "description": "Мокрые маршруты доступны, а мебель не мешает активным требованиям безопасности бассейна и оборудования.",
          "metric_id": "active_safety_rules",
          "rule_refs": [
            "SAFE005",
            "CLIM009",
            "CLIM011"
          ],
          "threshold_source": "Применимые подтверждённые нормы и инструкции",
          "expected_value": null,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        }
      ],
      "comfort_checks": [
        {
          "check_id": "SCN012-C01",
          "description": "Мокрый путь по возможности отделён от сухих жилых зон.",
          "metric_id": "route_activity_intersections",
          "rule_refs": [
            "PATH014"
          ],
          "threshold_source": "Мягкая цель брифа или дизайн-профиля",
          "expected_value": null,
          "observed_value": null,
          "result": null,
          "status": "specification_only",
          "severity": "soft",
          "weight": null,
          "target_value": null,
          "promotion_to_hard_requirement_id": null
        },
        {
          "check_id": "SCN012-C02",
          "description": "Полотенца доступны без длинного обхода.",
          "metric_id": "route_length",
          "rule_refs": [
            "PATH014"
          ],
          "threshold_source": "Мягкая цель брифа или дизайн-профиля",
          "expected_value": null,
          "observed_value": null,
          "result": null,
          "status": "specification_only",
          "severity": "soft",
          "weight": null,
          "target_value": null,
          "promotion_to_hard_requirement_id": null
        }
      ],
      "missing_inputs": [
        {
          "field_path": "brief.daily_life.wellness",
          "reason": "Нужны число пользователей, наблюдение и этапы пользования.",
          "value": null,
          "blocking_scope": "scenario"
        },
        {
          "field_path": "brief.engineering.external_validation_records",
          "reason": "Нужны подтверждения бассейна и мокрых зон.",
          "value": null,
          "blocking_scope": "safety"
        },
        {
          "field_path": "brief.building.rooms",
          "reason": "Нужны реальные связи бассейна, душа и раздевалки.",
          "value": null,
          "blocking_scope": "geometry"
        }
      ],
      "execution_results": null
    },
    {
      "scenario_id": "SCN013",
      "core_rule_id": "SCN013",
      "title": "Уход за пожилым",
      "description": "Пользователь с заданной мобильностью идет к кровати, ванной, креслу; помощник рядом при необходимости.",
      "status": "specification_only",
      "enabled": null,
      "mandatory": null,
      "activation_condition": "Подтверждены конкретные потребности мобильности/ухода; возраст сам по себе не задаёт ограничения.",
      "frequency": {
        "value": null,
        "period": null,
        "seasonality": null,
        "source_id": null
      },
      "priority": null,
      "actors": [
        {
          "role_id": "assisted_user",
          "description": "Пользователь с заданными потребностями",
          "person_ids": null,
          "count": null,
          "binding_source": "brief.household.members",
          "body_or_device_model_ref": null,
          "carried_objects": null,
          "binding_verified": null
        },
        {
          "role_id": "assistant",
          "description": "Помощник, если необходим",
          "person_ids": null,
          "count": null,
          "binding_source": "brief.household.members",
          "body_or_device_model_ref": null,
          "carried_objects": null,
          "binding_verified": null
        }
      ],
      "tasks": [
        {
          "task_id": "approach_bed",
          "actor_role": "assisted_user",
          "action": "Подъехать/подойти к кровати",
          "target_anchor_role": "bed_transfer_side",
          "depends_on": [],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Сценарий включён, функция подтверждена брифом и участник привязан"
        },
        {
          "task_id": "transfer",
          "actor_role": "assisted_user",
          "action": "Пересесть выбранным способом",
          "target_anchor_role": "bed_transfer_side",
          "depends_on": [
            "approach_bed"
          ],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Сценарий включён, функция подтверждена брифом и участник привязан"
        },
        {
          "task_id": "assist",
          "actor_role": "assistant",
          "action": "Помочь в предусмотренной позе",
          "target_anchor_role": "assistant_anchor",
          "depends_on": [],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Индивидуальный профиль пользователя требует помощи; помощник привязан"
        },
        {
          "task_id": "to_bathroom",
          "actor_role": "assisted_user",
          "action": "Дойти/доехать к санузлу",
          "target_anchor_role": "accessible_bathroom",
          "depends_on": [],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Сценарий включён, функция подтверждена брифом и участник привязан"
        },
        {
          "task_id": "sit",
          "actor_role": "assisted_user",
          "action": "Воспользоваться креслом",
          "target_anchor_role": "accessible_seat",
          "depends_on": [],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Сценарий включён, функция подтверждена брифом и участник привязан"
        }
      ],
      "required_states": [
        {
          "state_id": "TRANSFER",
          "description": "Реальная пересадка с местом помощника",
          "object_state_requirements": {
            "device": "actual_transfer_configuration",
            "bed": "confirmed_height",
            "assistant": "required_position"
          },
          "activation_condition": "Если соответствующий объект имеется и используется в этом сценарии",
          "concrete_object_ids": null,
          "verified": null
        },
        {
          "state_id": "ASSISTED_TRAVEL",
          "description": "Пользователь и средство мобильности движутся",
          "object_state_requirements": {
            "device": "travel_configuration",
            "doors": "accessible_maneuver_sequence"
          },
          "activation_condition": "Если соответствующий объект имеется и используется в этом сценарии",
          "concrete_object_ids": null,
          "verified": null
        }
      ],
      "route_pairs": [
        {
          "route_id": "bed_to_bathroom",
          "actor_role": "assisted_user",
          "from_anchor_role": "bed_transfer_side",
          "to_anchor_role": "accessible_bathroom",
          "state_ids": [
            "ASSISTED_TRAVEL"
          ],
          "carried_object_role": null,
          "concrete_anchor_ids": null,
          "metrics": null,
          "status": "specification_only"
        },
        {
          "route_id": "bed_to_seat",
          "actor_role": "assisted_user",
          "from_anchor_role": "bed_transfer_side",
          "to_anchor_role": "accessible_seat",
          "state_ids": [
            "ASSISTED_TRAVEL"
          ],
          "carried_object_role": null,
          "concrete_anchor_ids": null,
          "metrics": null,
          "status": "specification_only"
        }
      ],
      "concurrency": {
        "required_parallel_task_groups": [
          {
            "task_ids": [
              "transfer",
              "assist"
            ],
            "condition": "Если помощь требуется конкретному пользователю"
          }
        ],
        "mutually_exclusive_state_groups": [],
        "sequence_source": "tasks.depends_on",
        "user_confirmed": null,
        "policy": "Не объединять все открытые дверцы и все варианты состояния в один физически невозможный кадр. Одновременность связывается с конкретными участниками и фазами; последовательность проверяется отдельно.",
        "resource_policy": "Один конкретный человек и один предмет не могут одновременно занимать несовместимые позы/места. Параллельные задачи одной роли требуют разных actor_instance_id, кроме явно совместимых составных действий."
      },
      "required_checks": [
        {
          "check_id": "SCN013-R01",
          "description": "Нет недопустимых столкновений предметов и тела в требуемых совместимых состояниях.",
          "metric_id": "solid_collisions_count",
          "rule_refs": [
            "GEO004",
            "GEO005",
            "GEO014"
          ],
          "threshold_source": "Физическая совместимость; допустимые сопряжения указаны в модели",
          "expected_value": 0,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        },
        {
          "check_id": "SCN013-R02",
          "description": "Все обязательные действия и их входные/выходные маршруты доступны конкретным участникам.",
          "metric_id": "required_route_reachable",
          "rule_refs": [
            "PATH001",
            "PATH002",
            "GEO016"
          ],
          "threshold_source": "Обязательные функции выбранного сценария",
          "expected_value": true,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        },
        {
          "check_id": "SCN013-R03",
          "description": "Выполнены активные требования безопасности и ограничения паспортов; неизвестные данные остаются unknown.",
          "metric_id": "active_safety_rules",
          "rule_refs": [
            "OPT002",
            "OPT003",
            "QA006"
          ],
          "threshold_source": "Только подтверждённые применимые требования",
          "expected_value": null,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        },
        {
          "check_id": "SCN013-R04",
          "description": "Реальная коляска/ходунки и способ пересадки помещаются вместе с помощником.",
          "metric_id": "observed_user_ergonomics",
          "rule_refs": [
            "ACC016",
            "SAFE014"
          ],
          "threshold_source": "Подтверждённые индивидуальные требования",
          "expected_value": null,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        },
        {
          "check_id": "SCN013-R05",
          "description": "Выбранные справочные или юридические требования доступности проверяются отдельно.",
          "metric_id": "active_safety_rules",
          "rule_refs": [
            "ACC001"
          ],
          "threshold_source": "Только активные профили с указанной целью; выбор ADA не меняет юрисдикцию",
          "expected_value": null,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        }
      ],
      "comfort_checks": [
        {
          "check_id": "SCN013-C01",
          "description": "Маршруты короткие, управление достижимо без лишних манёвров.",
          "metric_id": "route_length",
          "rule_refs": [
            "PATH022"
          ],
          "threshold_source": "Мягкая цель брифа или дизайн-профиля",
          "expected_value": null,
          "observed_value": null,
          "result": null,
          "status": "specification_only",
          "severity": "soft",
          "weight": null,
          "target_value": null,
          "promotion_to_hard_requirement_id": null
        },
        {
          "check_id": "SCN013-C02",
          "description": "Помощь сохраняет согласованную приватность.",
          "metric_id": "private_view_exposure",
          "rule_refs": [
            "PRIV003"
          ],
          "threshold_source": "Мягкая цель брифа или дизайн-профиля",
          "expected_value": null,
          "observed_value": null,
          "result": null,
          "status": "specification_only",
          "severity": "soft",
          "weight": null,
          "target_value": null,
          "promotion_to_hard_requirement_id": null
        }
      ],
      "missing_inputs": [
        {
          "field_path": "brief.household.members",
          "reason": "Нужны функциональные потребности, способ пересадки и помощь.",
          "value": null,
          "blocking_scope": "scenario"
        },
        {
          "field_path": "brief.household.assistive_devices",
          "reason": "Нужна реальная модель средства мобильности.",
          "value": null,
          "blocking_scope": "geometry"
        },
        {
          "field_path": "brief.profiles.selected_profiles",
          "reason": "Нужно отделить индивидуальное ТЗ, справочную проверку и закон.",
          "value": null,
          "blocking_scope": "compliance"
        }
      ],
      "execution_results": null
    },
    {
      "scenario_id": "SCN014",
      "core_rule_id": "SCN014",
      "title": "Выход ночью",
      "description": "В обычной ночной конфигурации житель выходит из спальни к выходу/лестнице.",
      "status": "specification_only",
      "enabled": null,
      "mandatory": null,
      "activation_condition": "Для постоянных спальных мест проверяется ночной выход; пожарное соответствие требует отдельного подтверждённого профиля.",
      "frequency": {
        "value": null,
        "period": null,
        "seasonality": null,
        "source_id": null
      },
      "priority": null,
      "actors": [
        {
          "role_id": "resident",
          "description": "Житель, выходящий ночью",
          "person_ids": null,
          "count": null,
          "binding_source": "brief.household.members",
          "body_or_device_model_ref": null,
          "carried_objects": null,
          "binding_verified": null
        }
      ],
      "tasks": [
        {
          "task_id": "wake",
          "actor_role": "resident",
          "action": "Проснуться и сесть",
          "target_anchor_role": "bed",
          "depends_on": [],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Сценарий включён, функция подтверждена брифом и участник привязан"
        },
        {
          "task_id": "rise",
          "actor_role": "resident",
          "action": "Встать на предусмотренную сторону",
          "target_anchor_role": "bed_exit",
          "depends_on": [
            "wake"
          ],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Сценарий включён, функция подтверждена брифом и участник привязан"
        },
        {
          "task_id": "exit_room",
          "actor_role": "resident",
          "action": "Дойти к двери спальни",
          "target_anchor_role": "bedroom_exit",
          "depends_on": [
            "rise"
          ],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Сценарий включён, функция подтверждена брифом и участник привязан"
        },
        {
          "task_id": "reach_exit",
          "actor_role": "resident",
          "action": "Дойти к подтверждённому выходу или безопасному продолжению маршрута",
          "target_anchor_role": "verified_exit",
          "depends_on": [
            "exit_room"
          ],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Сценарий включён, функция подтверждена брифом и участник привязан"
        }
      ],
      "required_states": [
        {
          "state_id": "NIGHT",
          "description": "Ночная расстановка с разложенной мебелью и шторами",
          "object_state_requirements": {
            "beds": "sleep_configuration",
            "curtains": "night_configuration",
            "movable_furniture": "night_positions",
            "lighting": "night_mode"
          },
          "activation_condition": "Если соответствующий объект имеется и используется в этом сценарии",
          "concrete_object_ids": null,
          "verified": null
        }
      ],
      "route_pairs": [
        {
          "route_id": "bed_to_door",
          "actor_role": "resident",
          "from_anchor_role": "bed_exit",
          "to_anchor_role": "bedroom_exit",
          "state_ids": [
            "NIGHT"
          ],
          "carried_object_role": null,
          "concrete_anchor_ids": null,
          "metrics": null,
          "status": "specification_only"
        },
        {
          "route_id": "door_to_exit",
          "actor_role": "resident",
          "from_anchor_role": "bedroom_exit",
          "to_anchor_role": "verified_exit",
          "state_ids": [
            "NIGHT"
          ],
          "carried_object_role": null,
          "concrete_anchor_ids": null,
          "metrics": null,
          "status": "specification_only"
        }
      ],
      "concurrency": {
        "required_parallel_task_groups": [
          {
            "task_ids": [
              "reach_exit"
            ],
            "condition": "При подтверждённом требовании нескольких одновременно выходящих моделировать отдельных людей"
          }
        ],
        "mutually_exclusive_state_groups": [],
        "sequence_source": "tasks.depends_on",
        "user_confirmed": null,
        "policy": "Не объединять все открытые дверцы и все варианты состояния в один физически невозможный кадр. Одновременность связывается с конкретными участниками и фазами; последовательность проверяется отдельно.",
        "resource_policy": "Один конкретный человек и один предмет не могут одновременно занимать несовместимые позы/места. Параллельные задачи одной роли требуют разных actor_instance_id, кроме явно совместимых составных действий."
      },
      "required_checks": [
        {
          "check_id": "SCN014-R01",
          "description": "Нет недопустимых столкновений предметов и тела в требуемых совместимых состояниях.",
          "metric_id": "solid_collisions_count",
          "rule_refs": [
            "GEO004",
            "GEO005",
            "GEO014"
          ],
          "threshold_source": "Физическая совместимость; допустимые сопряжения указаны в модели",
          "expected_value": 0,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        },
        {
          "check_id": "SCN014-R02",
          "description": "Все обязательные действия и их входные/выходные маршруты доступны конкретным участникам.",
          "metric_id": "required_route_reachable",
          "rule_refs": [
            "PATH001",
            "PATH002",
            "GEO016"
          ],
          "threshold_source": "Обязательные функции выбранного сценария",
          "expected_value": true,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        },
        {
          "check_id": "SCN014-R03",
          "description": "Выполнены активные требования безопасности и ограничения паспортов; неизвестные данные остаются unknown.",
          "metric_id": "active_safety_rules",
          "rule_refs": [
            "OPT002",
            "OPT003",
            "QA006"
          ],
          "threshold_source": "Только подтверждённые применимые требования",
          "expected_value": null,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        },
        {
          "check_id": "SCN014-R04",
          "description": "Выход не зависит от переноса тяжёлой мебели или недоступного действия.",
          "metric_id": "task_success",
          "rule_refs": [
            "GEO016",
            "SAFE006"
          ],
          "threshold_source": "Проверенная безопасная последовательность и применимый профиль",
          "expected_value": true,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        },
        {
          "check_id": "SCN014-R05",
          "description": "Окно не назначается выходом без подтверждённой пригодности.",
          "metric_id": "active_safety_rules",
          "rule_refs": [
            "SAFE007"
          ],
          "threshold_source": "Подтверждённые сведения о выходах",
          "expected_value": null,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        }
      ],
      "comfort_checks": [
        {
          "check_id": "SCN014-C01",
          "description": "Путь читается при ночном свете без низких неожиданных препятствий.",
          "metric_id": "illuminance_at_task",
          "rule_refs": [
            "LGT016"
          ],
          "threshold_source": "Мягкая цель брифа или дизайн-профиля",
          "expected_value": null,
          "observed_value": null,
          "result": null,
          "status": "specification_only",
          "severity": "soft",
          "weight": null,
          "target_value": null,
          "promotion_to_hard_requirement_id": null
        },
        {
          "check_id": "SCN014-C02",
          "description": "На ночном пути мало лишних поворотов.",
          "metric_id": "route_turns",
          "rule_refs": [
            "PATH012"
          ],
          "threshold_source": "Мягкая цель брифа или дизайн-профиля",
          "expected_value": null,
          "observed_value": null,
          "result": null,
          "status": "specification_only",
          "severity": "soft",
          "weight": null,
          "target_value": null,
          "promotion_to_hard_requirement_id": null
        }
      ],
      "missing_inputs": [
        {
          "field_path": "brief.engineering.approved_exit_information",
          "reason": "Нужны назначенные пригодные выходы и требования.",
          "value": null,
          "blocking_scope": "safety"
        },
        {
          "field_path": "brief.daily_life.sleep",
          "reason": "Нужны фактические ночные состояния и стороны кроватей.",
          "value": null,
          "blocking_scope": "scenario"
        },
        {
          "field_path": "brief.household.members",
          "reason": "Нужны участники и мобильность.",
          "value": null,
          "blocking_scope": "geometry"
        }
      ],
      "execution_results": null
    },
    {
      "scenario_id": "SCN015",
      "core_rule_id": "SCN015",
      "title": "Прием доставки",
      "description": "Крупная коробка проходит от входа до места распаковки.",
      "status": "specification_only",
      "enabled": null,
      "mandatory": null,
      "activation_condition": "Указаны реальные типы доставок или габаритные предметы, которые должны проходить в дом.",
      "frequency": {
        "value": null,
        "period": null,
        "seasonality": null,
        "source_id": null
      },
      "priority": null,
      "actors": [
        {
          "role_id": "carrier",
          "description": "Человек или группа, несущая предмет",
          "person_ids": null,
          "count": null,
          "binding_source": "brief.furniture_and_procurement.delivery_handling",
          "body_or_device_model_ref": null,
          "carried_objects": null,
          "binding_verified": null
        }
      ],
      "tasks": [
        {
          "task_id": "receive",
          "actor_role": "carrier",
          "action": "Принять предмет у входа",
          "target_anchor_role": "delivery_entry",
          "depends_on": [],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Сценарий включён, функция подтверждена брифом и участник привязан"
        },
        {
          "task_id": "carry",
          "actor_role": "carrier",
          "action": "Перенести к месту распаковки",
          "target_anchor_role": "unpacking_zone",
          "depends_on": [
            "receive"
          ],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Сценарий включён, функция подтверждена брифом и участник привязан"
        },
        {
          "task_id": "stage",
          "actor_role": "carrier",
          "action": "Поставить предмет безопасно",
          "target_anchor_role": "unpacking_zone",
          "depends_on": [
            "carry"
          ],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Сценарий включён, функция подтверждена брифом и участник привязан"
        },
        {
          "task_id": "unpack",
          "actor_role": "carrier",
          "action": "Распаковать и убрать упаковку",
          "target_anchor_role": "unpacking_zone",
          "depends_on": [
            "stage"
          ],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Сценарий включён, функция подтверждена брифом и участник привязан"
        }
      ],
      "required_states": [
        {
          "state_id": "DELIVERY",
          "description": "Фактический груз и тела несущих проходят по маршруту",
          "object_state_requirements": {
            "package": "actual_dimensions_orientation",
            "doors": "required_open_sequence",
            "staging": "free_for_package"
          },
          "activation_condition": "Если соответствующий объект имеется и используется в этом сценарии",
          "concrete_object_ids": null,
          "verified": null
        }
      ],
      "route_pairs": [
        {
          "route_id": "delivery_to_unpack",
          "actor_role": "carrier",
          "from_anchor_role": "delivery_entry",
          "to_anchor_role": "unpacking_zone",
          "state_ids": [
            "DELIVERY"
          ],
          "carried_object_role": "actual_package",
          "concrete_anchor_ids": null,
          "metrics": null,
          "status": "specification_only"
        }
      ],
      "concurrency": {
        "required_parallel_task_groups": [
          {
            "task_ids": [
              "carry"
            ],
            "condition": "Если предмет несут несколько человек, проверяется общий swept-volume груза и всех участников"
          }
        ],
        "mutually_exclusive_state_groups": [],
        "sequence_source": "tasks.depends_on",
        "user_confirmed": null,
        "policy": "Не объединять все открытые дверцы и все варианты состояния в один физически невозможный кадр. Одновременность связывается с конкретными участниками и фазами; последовательность проверяется отдельно.",
        "resource_policy": "Один конкретный человек и один предмет не могут одновременно занимать несовместимые позы/места. Параллельные задачи одной роли требуют разных actor_instance_id, кроме явно совместимых составных действий."
      },
      "required_checks": [
        {
          "check_id": "SCN015-R01",
          "description": "Нет недопустимых столкновений предметов и тела в требуемых совместимых состояниях.",
          "metric_id": "solid_collisions_count",
          "rule_refs": [
            "GEO004",
            "GEO005",
            "GEO014"
          ],
          "threshold_source": "Физическая совместимость; допустимые сопряжения указаны в модели",
          "expected_value": 0,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        },
        {
          "check_id": "SCN015-R02",
          "description": "Все обязательные действия и их входные/выходные маршруты доступны конкретным участникам.",
          "metric_id": "required_route_reachable",
          "rule_refs": [
            "PATH001",
            "PATH002",
            "GEO016"
          ],
          "threshold_source": "Обязательные функции выбранного сценария",
          "expected_value": true,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        },
        {
          "check_id": "SCN015-R03",
          "description": "Выполнены активные требования безопасности и ограничения паспортов; неизвестные данные остаются unknown.",
          "metric_id": "active_safety_rules",
          "rule_refs": [
            "OPT002",
            "OPT003",
            "QA006"
          ],
          "threshold_source": "Только подтверждённые применимые требования",
          "expected_value": null,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        },
        {
          "check_id": "SCN015-R04",
          "description": "Предмет проходит повороты, лестницы и двери с разрешённой ориентацией либо подтверждённой разборкой.",
          "metric_id": "hand_carry_reachability",
          "rule_refs": [
            "GEO019",
            "GEO021"
          ],
          "threshold_source": "Реальный груз и инструкция обращения",
          "expected_value": true,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        },
        {
          "check_id": "SCN015-R05",
          "description": "Место распаковки не занимает запрещённый путь выхода.",
          "metric_id": "task_success",
          "rule_refs": [
            "SAFE006"
          ],
          "threshold_source": "Применимый профиль и подтверждённая зона распаковки",
          "expected_value": true,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        }
      ],
      "comfort_checks": [
        {
          "check_id": "SCN015-C01",
          "description": "Требуется меньше сложных поворотов и перестановок.",
          "metric_id": "route_turns",
          "rule_refs": [
            "PATH022"
          ],
          "threshold_source": "Мягкая цель брифа или дизайн-профиля",
          "expected_value": null,
          "observed_value": null,
          "result": null,
          "status": "specification_only",
          "severity": "soft",
          "weight": null,
          "target_value": null,
          "promotion_to_hard_requirement_id": null
        }
      ],
      "missing_inputs": [
        {
          "field_path": "brief.furniture_and_procurement.delivery_route_geometry",
          "reason": "Нужны полный маршрут и высоты.",
          "value": null,
          "blocking_scope": "geometry"
        },
        {
          "field_path": "brief.daily_life.entrance",
          "reason": "Нужны типы обычных доставок.",
          "value": null,
          "blocking_scope": "scenario"
        },
        {
          "field_path": "brief.furniture_and_procurement.assembly_area",
          "reason": "Нужно место распаковки/сборки.",
          "value": null,
          "blocking_scope": "scenario"
        }
      ],
      "execution_results": null
    },
    {
      "scenario_id": "SCN016",
      "core_rule_id": "SCN016",
      "title": "Работа персонала",
      "description": "Уборка/подача идет во время пребывания семьи и гостей.",
      "status": "specification_only",
      "enabled": null,
      "mandatory": null,
      "activation_condition": "Персонал или регулярная помощь действительно предусмотрены; не включать автоматически из-за площади дома.",
      "frequency": {
        "value": null,
        "period": null,
        "seasonality": null,
        "source_id": null
      },
      "priority": null,
      "actors": [
        {
          "role_id": "staff",
          "description": "Работник выбранной роли",
          "person_ids": null,
          "count": null,
          "binding_source": "brief.daily_life.staff_roles",
          "body_or_device_model_ref": null,
          "carried_objects": null,
          "binding_verified": null
        },
        {
          "role_id": "residents_or_guests",
          "description": "Находящиеся дома люди",
          "person_ids": null,
          "count": null,
          "binding_source": "brief.household.members",
          "body_or_device_model_ref": null,
          "carried_objects": null,
          "binding_verified": null
        }
      ],
      "tasks": [
        {
          "task_id": "staff_enter",
          "actor_role": "staff",
          "action": "Войти и взять рабочий инвентарь",
          "target_anchor_role": "staff_entry",
          "depends_on": [],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Сценарий включён, функция подтверждена брифом и участник привязан"
        },
        {
          "task_id": "service",
          "actor_role": "staff",
          "action": "Выполнить подтверждённую услугу",
          "target_anchor_role": "service_target",
          "depends_on": [
            "staff_enter"
          ],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Сценарий включён, функция подтверждена брифом и участник привязан"
        },
        {
          "task_id": "resident_activity",
          "actor_role": "residents_or_guests",
          "action": "Продолжить обычное занятие",
          "target_anchor_role": "occupied_activity",
          "depends_on": [],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Сценарий включён, функция подтверждена брифом и участник привязан"
        },
        {
          "task_id": "return_items",
          "actor_role": "staff",
          "action": "Убрать инвентарь или посуду",
          "target_anchor_role": "service_storage",
          "depends_on": [
            "service"
          ],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Сценарий включён, функция подтверждена брифом и участник привязан"
        }
      ],
      "required_states": [
        {
          "state_id": "SERVICE_WITH_OCCUPANCY",
          "description": "Служебное действие происходит при реальной занятости дома",
          "object_state_requirements": {
            "living_seats": "occupied_as_confirmed",
            "service_equipment": "actual_envelope",
            "private_doors": "agreed_state"
          },
          "activation_condition": "Если соответствующий объект имеется и используется в этом сценарии",
          "concrete_object_ids": null,
          "verified": null
        }
      ],
      "route_pairs": [
        {
          "route_id": "staff_entry_to_task",
          "actor_role": "staff",
          "from_anchor_role": "staff_entry",
          "to_anchor_role": "service_target",
          "state_ids": [
            "SERVICE_WITH_OCCUPANCY"
          ],
          "carried_object_role": "service_equipment",
          "concrete_anchor_ids": null,
          "metrics": null,
          "status": "specification_only"
        },
        {
          "route_id": "task_to_storage",
          "actor_role": "staff",
          "from_anchor_role": "service_target",
          "to_anchor_role": "service_storage",
          "state_ids": [
            "SERVICE_WITH_OCCUPANCY"
          ],
          "carried_object_role": "used_equipment",
          "concrete_anchor_ids": null,
          "metrics": null,
          "status": "specification_only"
        }
      ],
      "concurrency": {
        "required_parallel_task_groups": [
          {
            "task_ids": [
              "service",
              "resident_activity"
            ],
            "condition": "При совпадении подтверждённых расписаний"
          }
        ],
        "mutually_exclusive_state_groups": [],
        "sequence_source": "tasks.depends_on",
        "user_confirmed": null,
        "policy": "Не объединять все открытые дверцы и все варианты состояния в один физически невозможный кадр. Одновременность связывается с конкретными участниками и фазами; последовательность проверяется отдельно.",
        "resource_policy": "Один конкретный человек и один предмет не могут одновременно занимать несовместимые позы/места. Параллельные задачи одной роли требуют разных actor_instance_id, кроме явно совместимых составных действий."
      },
      "required_checks": [
        {
          "check_id": "SCN016-R01",
          "description": "Нет недопустимых столкновений предметов и тела в требуемых совместимых состояниях.",
          "metric_id": "solid_collisions_count",
          "rule_refs": [
            "GEO004",
            "GEO005",
            "GEO014"
          ],
          "threshold_source": "Физическая совместимость; допустимые сопряжения указаны в модели",
          "expected_value": 0,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        },
        {
          "check_id": "SCN016-R02",
          "description": "Все обязательные действия и их входные/выходные маршруты доступны конкретным участникам.",
          "metric_id": "required_route_reachable",
          "rule_refs": [
            "PATH001",
            "PATH002",
            "GEO016"
          ],
          "threshold_source": "Обязательные функции выбранного сценария",
          "expected_value": true,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        },
        {
          "check_id": "SCN016-R03",
          "description": "Выполнены активные требования безопасности и ограничения паспортов; неизвестные данные остаются unknown.",
          "metric_id": "active_safety_rules",
          "rule_refs": [
            "OPT002",
            "OPT003",
            "QA006"
          ],
          "threshold_source": "Только подтверждённые применимые требования",
          "expected_value": null,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        },
        {
          "check_id": "SCN016-R04",
          "description": "Сервисное действие и используемые пути физически доступны при занятости дома.",
          "metric_id": "task_success",
          "rule_refs": [
            "PATH016",
            "GEO015"
          ],
          "threshold_source": "Подтверждённые служебные функции",
          "expected_value": true,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        }
      ],
      "comfort_checks": [
        {
          "check_id": "SCN016-C01",
          "description": "Служебный путь меньше затрагивает приватные занятия.",
          "metric_id": "private_view_exposure",
          "rule_refs": [
            "PRIV006"
          ],
          "threshold_source": "Мягкая цель брифа или дизайн-профиля",
          "expected_value": null,
          "observed_value": null,
          "result": null,
          "status": "specification_only",
          "severity": "soft",
          "weight": null,
          "target_value": null,
          "promotion_to_hard_requirement_id": null
        },
        {
          "check_id": "SCN016-C02",
          "description": "Работа не занимает весь главный маршрут надолго.",
          "metric_id": "route_activity_intersections",
          "rule_refs": [
            "PATH021"
          ],
          "threshold_source": "Мягкая цель брифа или дизайн-профиля",
          "expected_value": null,
          "observed_value": null,
          "result": null,
          "status": "specification_only",
          "severity": "soft",
          "weight": null,
          "target_value": null,
          "promotion_to_hard_requirement_id": null
        }
      ],
      "missing_inputs": [
        {
          "field_path": "brief.daily_life.staff_roles",
          "reason": "Нужны роли, расписания и допустимые зоны.",
          "value": null,
          "blocking_scope": "scenario"
        },
        {
          "field_path": "brief.daily_life.habits",
          "reason": "Нужны одновременные занятия жильцов.",
          "value": null,
          "blocking_scope": "concurrency"
        }
      ],
      "execution_results": null
    },
    {
      "scenario_id": "SCN017",
      "core_rule_id": "SCN017",
      "title": "Зима и лето",
      "description": "Используются отопление, плотные шторы, сезонные ковры и уличная мебель.",
      "status": "specification_only",
      "enabled": null,
      "mandatory": null,
      "activation_condition": "Подтверждены разные сезонные конфигурации мебели, текстиля или использования террас.",
      "frequency": {
        "value": null,
        "period": null,
        "seasonality": null,
        "source_id": null
      },
      "priority": null,
      "actors": [
        {
          "role_id": "household",
          "description": "Пользователи дома в выбранный сезон",
          "person_ids": null,
          "count": null,
          "binding_source": "brief.household.members",
          "body_or_device_model_ref": null,
          "carried_objects": null,
          "binding_verified": null
        }
      ],
      "tasks": [
        {
          "task_id": "winter_use",
          "actor_role": "household",
          "action": "Использовать зимнюю конфигурацию",
          "target_anchor_role": "winter_activity",
          "depends_on": [],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Сценарий включён, функция подтверждена брифом и участник привязан"
        },
        {
          "task_id": "summer_use",
          "actor_role": "household",
          "action": "Использовать летнюю конфигурацию",
          "target_anchor_role": "summer_activity",
          "depends_on": [],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Сценарий включён, функция подтверждена брифом и участник привязан"
        },
        {
          "task_id": "season_change",
          "actor_role": "household",
          "action": "Переставить и убрать сезонные предметы",
          "target_anchor_role": "seasonal_storage",
          "depends_on": [],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Сценарий включён, функция подтверждена брифом и участник привязан"
        }
      ],
      "required_states": [
        {
          "state_id": "WINTER",
          "description": "Зимние предметы и системы в реальном положении",
          "object_state_requirements": {
            "curtains": "winter_volume",
            "heating": "active_profile",
            "rugs": "winter_positions",
            "outdoor_furniture": "winter_storage"
          },
          "activation_condition": "Если соответствующий объект имеется и используется в этом сценарии",
          "concrete_object_ids": null,
          "verified": null
        },
        {
          "state_id": "SUMMER",
          "description": "Летняя конфигурация и террасные маршруты",
          "object_state_requirements": {
            "curtains": "summer_state",
            "terrace_furniture": "summer_positions",
            "cooling": "summer_profile"
          },
          "activation_condition": "Если соответствующий объект имеется и используется в этом сценарии",
          "concrete_object_ids": null,
          "verified": null
        }
      ],
      "route_pairs": [
        {
          "route_id": "winter_main",
          "actor_role": "household",
          "from_anchor_role": "entry",
          "to_anchor_role": "daily_activity",
          "state_ids": [
            "WINTER"
          ],
          "carried_object_role": null,
          "concrete_anchor_ids": null,
          "metrics": null,
          "status": "specification_only"
        },
        {
          "route_id": "summer_terrace",
          "actor_role": "household",
          "from_anchor_role": "living_zone",
          "to_anchor_role": "terrace",
          "state_ids": [
            "SUMMER"
          ],
          "carried_object_role": null,
          "concrete_anchor_ids": null,
          "metrics": null,
          "status": "specification_only"
        },
        {
          "route_id": "season_storage",
          "actor_role": "household",
          "from_anchor_role": "seasonal_furniture",
          "to_anchor_role": "seasonal_storage",
          "state_ids": [
            "WINTER",
            "SUMMER"
          ],
          "carried_object_role": "seasonal_items",
          "concrete_anchor_ids": null,
          "metrics": null,
          "status": "specification_only"
        }
      ],
      "concurrency": {
        "required_parallel_task_groups": [],
        "mutually_exclusive_state_groups": [
          [
            "WINTER",
            "SUMMER"
          ]
        ],
        "sequence_source": "tasks.depends_on",
        "user_confirmed": null,
        "policy": "Не объединять все открытые дверцы и все варианты состояния в один физически невозможный кадр. Одновременность связывается с конкретными участниками и фазами; последовательность проверяется отдельно.",
        "resource_policy": "Один конкретный человек и один предмет не могут одновременно занимать несовместимые позы/места. Параллельные задачи одной роли требуют разных actor_instance_id, кроме явно совместимых составных действий."
      },
      "required_checks": [
        {
          "check_id": "SCN017-R01",
          "description": "Нет недопустимых столкновений предметов и тела в требуемых совместимых состояниях.",
          "metric_id": "solid_collisions_count",
          "rule_refs": [
            "GEO004",
            "GEO005",
            "GEO014"
          ],
          "threshold_source": "Физическая совместимость; допустимые сопряжения указаны в модели",
          "expected_value": 0,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        },
        {
          "check_id": "SCN017-R02",
          "description": "Все обязательные действия и их входные/выходные маршруты доступны конкретным участникам.",
          "metric_id": "required_route_reachable",
          "rule_refs": [
            "PATH001",
            "PATH002",
            "GEO016"
          ],
          "threshold_source": "Обязательные функции выбранного сценария",
          "expected_value": true,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        },
        {
          "check_id": "SCN017-R03",
          "description": "Выполнены активные требования безопасности и ограничения паспортов; неизвестные данные остаются unknown.",
          "metric_id": "active_safety_rules",
          "rule_refs": [
            "OPT002",
            "OPT003",
            "QA006"
          ],
          "threshold_source": "Только подтверждённые применимые требования",
          "expected_value": null,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        },
        {
          "check_id": "SCN017-R04",
          "description": "Каждая сезонная конфигурация сохраняет открывание и паспортные зоны отопления/вентиляции.",
          "metric_id": "thermal_service_clearance",
          "rule_refs": [
            "CLIM001",
            "CLIM005",
            "CLIM008"
          ],
          "threshold_source": "Паспорта и проект инженерии",
          "expected_value": null,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        },
        {
          "check_id": "SCN017-R05",
          "description": "Сезонные вещи имеют подтверждённое место хранения.",
          "metric_id": "storage_capacity_match",
          "rule_refs": [
            "IN016"
          ],
          "threshold_source": "Сезонный инвентарь",
          "expected_value": true,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        }
      ],
      "comfort_checks": [
        {
          "check_id": "SCN017-C01",
          "description": "Переход между сезонами не требует чрезмерных перестановок.",
          "metric_id": "change_cost",
          "rule_refs": [
            "SCN017"
          ],
          "threshold_source": "Мягкая цель брифа или дизайн-профиля",
          "expected_value": null,
          "observed_value": null,
          "result": null,
          "status": "specification_only",
          "severity": "soft",
          "weight": null,
          "target_value": null,
          "promotion_to_hard_requirement_id": null
        },
        {
          "check_id": "SCN017-C02",
          "description": "Сохраняются основные виды и удобство террасы.",
          "metric_id": "view_target_visibility",
          "rule_refs": [
            "VIS004"
          ],
          "threshold_source": "Мягкая цель брифа или дизайн-профиля",
          "expected_value": null,
          "observed_value": null,
          "result": null,
          "status": "specification_only",
          "severity": "soft",
          "weight": null,
          "target_value": null,
          "promotion_to_hard_requirement_id": null
        }
      ],
      "missing_inputs": [
        {
          "field_path": "brief.daily_life.seasons",
          "reason": "Нужны реальные конфигурации обоих сезонов.",
          "value": null,
          "blocking_scope": "scenario"
        },
        {
          "field_path": "brief.storage_inventory.items",
          "reason": "Нужны сезонные предметы и хранение.",
          "value": null,
          "blocking_scope": "capacity"
        },
        {
          "field_path": "brief.engineering",
          "reason": "Нужны зимние и летние инженерные ограничения.",
          "value": null,
          "blocking_scope": "engineering"
        }
      ],
      "execution_results": null
    },
    {
      "scenario_id": "SCN018",
      "core_rule_id": "SCN018",
      "title": "Рост ребенка",
      "description": "Меняются кровать, рабочий стол, количество вещей и самостоятельность.",
      "status": "specification_only",
      "enabled": null,
      "mandatory": null,
      "activation_condition": "Нужна адаптация детской в согласованном горизонте; будущая семья и сроки не предполагаются автоматически.",
      "frequency": {
        "value": null,
        "period": null,
        "seasonality": null,
        "source_id": null
      },
      "priority": null,
      "actors": [
        {
          "role_id": "growing_child",
          "description": "Пользователь детской на подтверждённых этапах",
          "person_ids": null,
          "count": null,
          "binding_source": "brief.household.members",
          "body_or_device_model_ref": null,
          "carried_objects": null,
          "binding_verified": null
        }
      ],
      "tasks": [
        {
          "task_id": "current_use",
          "actor_role": "growing_child",
          "action": "Использовать комнату сейчас",
          "target_anchor_role": "child_room_current",
          "depends_on": [],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Сценарий включён, функция подтверждена брифом и участник привязан"
        },
        {
          "task_id": "future_use",
          "actor_role": "growing_child",
          "action": "Использовать согласованный будущий набор функций",
          "target_anchor_role": "child_room_future",
          "depends_on": [],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Сценарий включён, функция подтверждена брифом и участник привязан"
        },
        {
          "task_id": "replace_modules",
          "actor_role": "growing_child",
          "action": "Заменить разрешённые модули с помощью взрослых",
          "target_anchor_role": "replacement_staging",
          "depends_on": [],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Сценарий включён, функция подтверждена брифом и участник привязан"
        }
      ],
      "required_states": [
        {
          "state_id": "CURRENT",
          "description": "Текущая антропометрия и функции",
          "object_state_requirements": {
            "bed": "current_sku",
            "desk": "current_adjustment",
            "storage": "current_inventory"
          },
          "activation_condition": "Если соответствующий объект имеется и используется в этом сценарии",
          "concrete_object_ids": null,
          "verified": null
        },
        {
          "state_id": "FUTURE",
          "description": "Подтверждённый будущий набор, размеры остаются входами",
          "object_state_requirements": {
            "bed": "future_allowed_sku",
            "desk": "future_adjustment",
            "storage": "future_inventory"
          },
          "activation_condition": "Если соответствующий объект имеется и используется в этом сценарии",
          "concrete_object_ids": null,
          "verified": null
        }
      ],
      "route_pairs": [
        {
          "route_id": "current_room_access",
          "actor_role": "growing_child",
          "from_anchor_role": "child_room_entry",
          "to_anchor_role": "current_tasks",
          "state_ids": [
            "CURRENT"
          ],
          "carried_object_role": null,
          "concrete_anchor_ids": null,
          "metrics": null,
          "status": "specification_only"
        },
        {
          "route_id": "future_room_access",
          "actor_role": "growing_child",
          "from_anchor_role": "child_room_entry",
          "to_anchor_role": "future_tasks",
          "state_ids": [
            "FUTURE"
          ],
          "carried_object_role": null,
          "concrete_anchor_ids": null,
          "metrics": null,
          "status": "specification_only"
        }
      ],
      "concurrency": {
        "required_parallel_task_groups": [],
        "mutually_exclusive_state_groups": [
          [
            "CURRENT",
            "FUTURE"
          ]
        ],
        "sequence_source": "tasks.depends_on",
        "user_confirmed": null,
        "policy": "Не объединять все открытые дверцы и все варианты состояния в один физически невозможный кадр. Одновременность связывается с конкретными участниками и фазами; последовательность проверяется отдельно.",
        "resource_policy": "Один конкретный человек и один предмет не могут одновременно занимать несовместимые позы/места. Параллельные задачи одной роли требуют разных actor_instance_id, кроме явно совместимых составных действий."
      },
      "required_checks": [
        {
          "check_id": "SCN018-R01",
          "description": "Нет недопустимых столкновений предметов и тела в требуемых совместимых состояниях.",
          "metric_id": "solid_collisions_count",
          "rule_refs": [
            "GEO004",
            "GEO005",
            "GEO014"
          ],
          "threshold_source": "Физическая совместимость; допустимые сопряжения указаны в модели",
          "expected_value": 0,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        },
        {
          "check_id": "SCN018-R02",
          "description": "Все обязательные действия и их входные/выходные маршруты доступны конкретным участникам.",
          "metric_id": "required_route_reachable",
          "rule_refs": [
            "PATH001",
            "PATH002",
            "GEO016"
          ],
          "threshold_source": "Обязательные функции выбранного сценария",
          "expected_value": true,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        },
        {
          "check_id": "SCN018-R03",
          "description": "Выполнены активные требования безопасности и ограничения паспортов; неизвестные данные остаются unknown.",
          "metric_id": "active_safety_rules",
          "rule_refs": [
            "OPT002",
            "OPT003",
            "QA006"
          ],
          "threshold_source": "Только подтверждённые применимые требования",
          "expected_value": null,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        },
        {
          "check_id": "SCN018-R04",
          "description": "Оба подтверждённых этапа выполняют обязательные функции без неразрешённого изменения архитектуры.",
          "metric_id": "task_success",
          "rule_refs": [
            "IN006",
            "IN008",
            "GEO023"
          ],
          "threshold_source": "Явный горизонт и состав будущих требований",
          "expected_value": true,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        }
      ],
      "comfort_checks": [
        {
          "check_id": "SCN018-C01",
          "description": "Для перехода требуется заменить меньше пригодных предметов.",
          "metric_id": "change_cost",
          "rule_refs": [
            "SCN018"
          ],
          "threshold_source": "Мягкая цель брифа или дизайн-профиля",
          "expected_value": null,
          "observed_value": null,
          "result": null,
          "status": "specification_only",
          "severity": "soft",
          "weight": null,
          "target_value": null,
          "promotion_to_hard_requirement_id": null
        },
        {
          "check_id": "SCN018-C02",
          "description": "Каждый этап соответствует реальной или явно предполагаемой антропометрии.",
          "metric_id": "observed_user_ergonomics",
          "rule_refs": [
            "IN015"
          ],
          "threshold_source": "Мягкая цель брифа или дизайн-профиля",
          "expected_value": null,
          "observed_value": null,
          "result": null,
          "status": "specification_only",
          "severity": "soft",
          "weight": null,
          "target_value": null,
          "promotion_to_hard_requirement_id": null
        }
      ],
      "missing_inputs": [
        {
          "field_path": "brief.daily_life.future_changes",
          "reason": "Нужны горизонт и конкретные будущие функции.",
          "value": null,
          "blocking_scope": "scenario"
        },
        {
          "field_path": "brief.household.members",
          "reason": "Нужны текущие данные ребёнка; будущие значения отдельно отмечаются предположенными.",
          "value": null,
          "blocking_scope": "ergonomics"
        },
        {
          "field_path": "brief.change_permissions",
          "reason": "Нужны допустимые замены и регулировки.",
          "value": null,
          "blocking_scope": "permissions"
        }
      ],
      "execution_results": null
    },
    {
      "scenario_id": "SCN019",
      "core_rule_id": "SCN019",
      "title": "Размещение питомца",
      "description": "Лежанка, корм и уборка располагаются по выбранным привычкам семьи.",
      "status": "specification_only",
      "enabled": null,
      "mandatory": null,
      "activation_condition": "Питомец существует или явно планируется; вид и привычки подтверждены.",
      "frequency": {
        "value": null,
        "period": null,
        "seasonality": null,
        "source_id": null
      },
      "priority": null,
      "actors": [
        {
          "role_id": "pet",
          "description": "Реальный питомец",
          "person_ids": null,
          "count": null,
          "binding_source": "brief.household.pets",
          "body_or_device_model_ref": null,
          "carried_objects": null,
          "binding_verified": null
        },
        {
          "role_id": "caregiver",
          "description": "Ухаживающий человек",
          "person_ids": null,
          "count": null,
          "binding_source": "brief.household.members",
          "body_or_device_model_ref": null,
          "carried_objects": null,
          "binding_verified": null
        },
        {
          "role_id": "passer",
          "description": "Проходящий человек",
          "person_ids": null,
          "count": null,
          "binding_source": "brief.household.members",
          "body_or_device_model_ref": null,
          "carried_objects": null,
          "binding_verified": null
        }
      ],
      "tasks": [
        {
          "task_id": "rest",
          "actor_role": "pet",
          "action": "Отдыхать на назначенном месте",
          "target_anchor_role": "pet_bed",
          "depends_on": [],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Сценарий включён, функция подтверждена брифом и участник привязан"
        },
        {
          "task_id": "feed",
          "actor_role": "caregiver",
          "action": "Подать корм и воду",
          "target_anchor_role": "pet_food",
          "depends_on": [],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Сценарий включён, функция подтверждена брифом и участник привязан"
        },
        {
          "task_id": "pet_toilet",
          "actor_role": "pet",
          "action": "Воспользоваться выбранным местом, если оно в доме",
          "target_anchor_role": "pet_toilet",
          "depends_on": [],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Подтверждено, что туалет питомца находится внутри дома; иначе not_applicable"
        },
        {
          "task_id": "clean_pet",
          "actor_role": "caregiver",
          "action": "Убрать кормовую/туалетную зону",
          "target_anchor_role": "pet_cleaning_storage",
          "depends_on": [],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Сценарий включён, функция подтверждена брифом и участник привязан"
        },
        {
          "task_id": "pass",
          "actor_role": "passer",
          "action": "Пройти по домашнему маршруту",
          "target_anchor_role": "room_exit",
          "depends_on": [],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Сценарий включён, функция подтверждена брифом и участник привязан"
        }
      ],
      "required_states": [
        {
          "state_id": "PET_DAILY",
          "description": "Лежанка, миски и переноска занимают фактические места",
          "object_state_requirements": {
            "pet_bed": "occupied_or_available",
            "bowls": "in_use",
            "carrier": "stored_or_active_as_confirmed",
            "doors": "pet_access_policy"
          },
          "activation_condition": "Если соответствующий объект имеется и используется в этом сценарии",
          "concrete_object_ids": null,
          "verified": null
        }
      ],
      "route_pairs": [
        {
          "route_id": "pet_access",
          "actor_role": "pet",
          "from_anchor_role": "pet_bed",
          "to_anchor_role": "pet_food",
          "state_ids": [
            "PET_DAILY"
          ],
          "carried_object_role": null,
          "concrete_anchor_ids": null,
          "metrics": null,
          "status": "specification_only"
        },
        {
          "route_id": "human_past_pet",
          "actor_role": "passer",
          "from_anchor_role": "room_entry",
          "to_anchor_role": "room_exit",
          "state_ids": [
            "PET_DAILY"
          ],
          "carried_object_role": null,
          "concrete_anchor_ids": null,
          "metrics": null,
          "status": "specification_only"
        },
        {
          "route_id": "care_access",
          "actor_role": "caregiver",
          "from_anchor_role": "pet_cleaning_storage",
          "to_anchor_role": "pet_toilet",
          "state_ids": [
            "PET_DAILY"
          ],
          "carried_object_role": "cleaning_items",
          "concrete_anchor_ids": null,
          "metrics": null,
          "status": "specification_only"
        }
      ],
      "concurrency": {
        "required_parallel_task_groups": [
          {
            "task_ids": [
              "feed",
              "pass"
            ],
            "condition": "Если кормовая зона соседствует с используемым проходом"
          },
          {
            "task_ids": [
              "rest",
              "pass"
            ],
            "condition": "Проверить нормальное положение питомца, без обещания предсказать все его движения"
          }
        ],
        "mutually_exclusive_state_groups": [],
        "sequence_source": "tasks.depends_on",
        "user_confirmed": null,
        "policy": "Не объединять все открытые дверцы и все варианты состояния в один физически невозможный кадр. Одновременность связывается с конкретными участниками и фазами; последовательность проверяется отдельно.",
        "resource_policy": "Один конкретный человек и один предмет не могут одновременно занимать несовместимые позы/места. Параллельные задачи одной роли требуют разных actor_instance_id, кроме явно совместимых составных действий."
      },
      "required_checks": [
        {
          "check_id": "SCN019-R01",
          "description": "Нет недопустимых столкновений предметов и тела в требуемых совместимых состояниях.",
          "metric_id": "solid_collisions_count",
          "rule_refs": [
            "GEO004",
            "GEO005",
            "GEO014"
          ],
          "threshold_source": "Физическая совместимость; допустимые сопряжения указаны в модели",
          "expected_value": 0,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        },
        {
          "check_id": "SCN019-R02",
          "description": "Все обязательные действия и их входные/выходные маршруты доступны конкретным участникам.",
          "metric_id": "required_route_reachable",
          "rule_refs": [
            "PATH001",
            "PATH002",
            "GEO016"
          ],
          "threshold_source": "Обязательные функции выбранного сценария",
          "expected_value": true,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        },
        {
          "check_id": "SCN019-R03",
          "description": "Выполнены активные требования безопасности и ограничения паспортов; неизвестные данные остаются unknown.",
          "metric_id": "active_safety_rules",
          "rule_refs": [
            "OPT002",
            "OPT003",
            "QA006"
          ],
          "threshold_source": "Только подтверждённые применимые требования",
          "expected_value": null,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        },
        {
          "check_id": "SCN019-R04",
          "description": "Стационарные принадлежности и подтверждённая переноска не перекрывают обязательные пути.",
          "metric_id": "task_success",
          "rule_refs": [
            "GEO004",
            "PATH001"
          ],
          "threshold_source": "Геометрия предметов и профили пользователей",
          "expected_value": true,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        }
      ],
      "comfort_checks": [
        {
          "check_id": "SCN019-C01",
          "description": "Корм и уборка отделены от подачи человеческой пищи по выбранным привычкам.",
          "metric_id": "route_activity_intersections",
          "rule_refs": [
            "SCN019"
          ],
          "threshold_source": "Мягкая цель брифа или дизайн-профиля",
          "expected_value": null,
          "observed_value": null,
          "result": null,
          "status": "specification_only",
          "severity": "soft",
          "weight": null,
          "target_value": null,
          "promotion_to_hard_requirement_id": null
        },
        {
          "check_id": "SCN019-C02",
          "description": "Уборка принадлежностей не требует сложного переноса через жилые зоны.",
          "metric_id": "route_length",
          "rule_refs": [
            "PATH016"
          ],
          "threshold_source": "Мягкая цель брифа или дизайн-профиля",
          "expected_value": null,
          "observed_value": null,
          "result": null,
          "status": "specification_only",
          "severity": "soft",
          "weight": null,
          "target_value": null,
          "promotion_to_hard_requirement_id": null
        }
      ],
      "missing_inputs": [
        {
          "field_path": "brief.household.pets",
          "reason": "Нужны вид, размер, число и привычки питомцев.",
          "value": null,
          "blocking_scope": "scenario"
        },
        {
          "field_path": "brief.daily_life.cleaning",
          "reason": "Нужен способ уборки принадлежностей.",
          "value": null,
          "blocking_scope": "scenario"
        }
      ],
      "execution_results": null
    },
    {
      "scenario_id": "SCN020",
      "core_rule_id": "SCN020",
      "title": "Обслуживание оборудования",
      "description": "Специалист извлекает фильтр, снимает панель, меняет прибор.",
      "status": "specification_only",
      "enabled": null,
      "mandatory": null,
      "activation_condition": "Оборудование имеет обслуживаемые части; операция задаётся паспортом конкретной модели.",
      "frequency": {
        "value": null,
        "period": null,
        "seasonality": null,
        "source_id": null
      },
      "priority": null,
      "actors": [
        {
          "role_id": "technician",
          "description": "Обслуживающий специалист",
          "person_ids": null,
          "count": null,
          "binding_source": "brief.engineering.points_and_equipment",
          "body_or_device_model_ref": null,
          "carried_objects": null,
          "binding_verified": null
        }
      ],
      "tasks": [
        {
          "task_id": "isolate",
          "actor_role": "technician",
          "action": "Получить предусмотренный доступ к отключению",
          "target_anchor_role": "service_controls",
          "depends_on": [],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Сценарий включён, функция подтверждена брифом и участник привязан"
        },
        {
          "task_id": "open_panel",
          "actor_role": "technician",
          "action": "Снять штатную сервисную панель",
          "target_anchor_role": "service_panel",
          "depends_on": [
            "isolate"
          ],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Сценарий включён, функция подтверждена брифом и участник привязан"
        },
        {
          "task_id": "extract",
          "actor_role": "technician",
          "action": "Извлечь фильтр/часть оборудования",
          "target_anchor_role": "equipment_part",
          "depends_on": [
            "open_panel"
          ],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Сценарий включён, функция подтверждена брифом и участник привязан"
        },
        {
          "task_id": "carry_out",
          "actor_role": "technician",
          "action": "Вынести часть по сервисному маршруту",
          "target_anchor_role": "service_exit",
          "depends_on": [
            "extract"
          ],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Сценарий включён, функция подтверждена брифом и участник привязан"
        },
        {
          "task_id": "restore",
          "actor_role": "technician",
          "action": "Вернуть оборудование и панели в штатное состояние",
          "target_anchor_role": "equipment",
          "depends_on": [
            "carry_out"
          ],
          "duration_minutes": null,
          "observed_success": null,
          "dependency_scope": "same_actor_instance_unless_explicit_cross_actor_dependency",
          "applicability_condition": "Сценарий включён, функция подтверждена брифом и участник привязан"
        }
      ],
      "required_states": [
        {
          "state_id": "SERVICE",
          "description": "Штатные съёмные части открыты только по последовательности инструкции",
          "object_state_requirements": {
            "service_panel": "removed_if_allowed",
            "equipment_part": "extraction_envelope",
            "technician": "required_work_pose",
            "built_in_furniture": "intact_except_designed_removable_parts"
          },
          "activation_condition": "Если соответствующий объект имеется и используется в этом сценарии",
          "concrete_object_ids": null,
          "verified": null
        }
      ],
      "route_pairs": [
        {
          "route_id": "service_approach",
          "actor_role": "technician",
          "from_anchor_role": "service_entry",
          "to_anchor_role": "equipment",
          "state_ids": [
            "SERVICE"
          ],
          "carried_object_role": "tools",
          "concrete_anchor_ids": null,
          "metrics": null,
          "status": "specification_only"
        },
        {
          "route_id": "part_extraction",
          "actor_role": "technician",
          "from_anchor_role": "equipment_part",
          "to_anchor_role": "service_exit",
          "state_ids": [
            "SERVICE"
          ],
          "carried_object_role": "equipment_part",
          "concrete_anchor_ids": null,
          "metrics": null,
          "status": "specification_only"
        }
      ],
      "concurrency": {
        "required_parallel_task_groups": [
          {
            "task_ids": [
              "extract"
            ],
            "condition": "Если инструкция требует двух специалистов, используются два подтверждённых тела и их совместный объём"
          }
        ],
        "mutually_exclusive_state_groups": [],
        "sequence_source": "tasks.depends_on",
        "user_confirmed": null,
        "policy": "Не объединять все открытые дверцы и все варианты состояния в один физически невозможный кадр. Одновременность связывается с конкретными участниками и фазами; последовательность проверяется отдельно.",
        "resource_policy": "Один конкретный человек и один предмет не могут одновременно занимать несовместимые позы/места. Параллельные задачи одной роли требуют разных actor_instance_id, кроме явно совместимых составных действий."
      },
      "required_checks": [
        {
          "check_id": "SCN020-R01",
          "description": "Нет недопустимых столкновений предметов и тела в требуемых совместимых состояниях.",
          "metric_id": "solid_collisions_count",
          "rule_refs": [
            "GEO004",
            "GEO005",
            "GEO014"
          ],
          "threshold_source": "Физическая совместимость; допустимые сопряжения указаны в модели",
          "expected_value": 0,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        },
        {
          "check_id": "SCN020-R02",
          "description": "Все обязательные действия и их входные/выходные маршруты доступны конкретным участникам.",
          "metric_id": "required_route_reachable",
          "rule_refs": [
            "PATH001",
            "PATH002",
            "GEO016"
          ],
          "threshold_source": "Обязательные функции выбранного сценария",
          "expected_value": true,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        },
        {
          "check_id": "SCN020-R03",
          "description": "Выполнены активные требования безопасности и ограничения паспортов; неизвестные данные остаются unknown.",
          "metric_id": "active_safety_rules",
          "rule_refs": [
            "OPT002",
            "OPT003",
            "QA006"
          ],
          "threshold_source": "Только подтверждённые применимые требования",
          "expected_value": null,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        },
        {
          "check_id": "SCN020-R04",
          "description": "Панель, инструмент, рабочая поза и извлечение соответствуют паспорту.",
          "metric_id": "maintenance_access",
          "rule_refs": [
            "CLIM010",
            "GEO020"
          ],
          "threshold_source": "Инструкция конкретного оборудования",
          "expected_value": true,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        },
        {
          "check_id": "SCN020-R05",
          "description": "Штатное обслуживание не требует разрушения встроенной мебели; предусмотренные съёмные панели допустимы.",
          "metric_id": "task_success",
          "rule_refs": [
            "SCN020"
          ],
          "threshold_source": "Разрешённый способ сервисного доступа",
          "expected_value": true,
          "observed_value": null,
          "result": null,
          "status": "specification_only"
        }
      ],
      "comfort_checks": [
        {
          "check_id": "SCN020-C01",
          "description": "Сервисный вынос минимально затрагивает личные и жилые зоны.",
          "metric_id": "route_activity_intersections",
          "rule_refs": [
            "PATH016",
            "PRIV006"
          ],
          "threshold_source": "Мягкая цель брифа или дизайн-профиля",
          "expected_value": null,
          "observed_value": null,
          "result": null,
          "status": "specification_only",
          "severity": "soft",
          "weight": null,
          "target_value": null,
          "promotion_to_hard_requirement_id": null
        }
      ],
      "missing_inputs": [
        {
          "field_path": "brief.engineering.points_and_equipment",
          "reason": "Нужны модели, сервисные объёмы, инструмент и последовательность.",
          "value": null,
          "blocking_scope": "engineering"
        },
        {
          "field_path": "brief.building",
          "reason": "Нужна геометрия сервисного маршрута, включая этажи.",
          "value": null,
          "blocking_scope": "geometry"
        },
        {
          "field_path": "brief.furniture_and_procurement.existing_items",
          "reason": "Нужны реальные съёмные панели и крепления встроенной мебели.",
          "value": null,
          "blocking_scope": "geometry"
        }
      ],
      "execution_results": null
    }
  ]
});
export const LAYOUT_SCENARIOS = LAYOUT_SCENARIO_LIBRARY.scenarios;

export const LAYOUT_PROFILE_SETTINGS = deepFreeze({
  "metadata": {
    "version": "1.0.0",
    "parameter_origin": "Все авторские веса и цели — начальная конфигурация, которую следует калибровать на пользовательских заданиях.",
    "no_universal_furniture_fill_ratio": true
  },
  "active_by_default": [
    "geometry_and_states",
    "large_house_comfort",
    "relevant_manufacturer_constraints"
  ],
  "profiles": [
    {
      "id": "geometry_and_states",
      "enabled": true,
      "scope": "Геометрия, доступ, реальные состояния, неизвестные данные."
    },
    {
      "id": "large_house_comfort",
      "enabled": true,
      "scope": "Цели для просторного частного дома; не менять их молча при конфликте.",
      "targets": [
        {
          "id": "primary_route",
          "related_rule_ids": [
            "PATH004"
          ],
          "values": {
            "preferred_floor": 900,
            "target_range": [
              1100,
              1200
            ]
          },
          "unit": "mm",
          "measurement": "Наименьший чистый размер поперек пути между препятствиями в выбранном состоянии.",
          "basis": "design_heuristic",
          "notes": "Настраиваемая проектная цель; не обязательная строительная норма.",
          "enforcement": "soft"
        },
        {
          "id": "frequent_two_way_route",
          "related_rule_ids": [
            "PATH005"
          ],
          "values": {
            "target_range": [
              1400,
              1600
            ]
          },
          "unit": "mm",
          "measurement": "Поперек пути двух реальных пользователей/переносимых вещей; точная проверка тел имеет приоритет.",
          "basis": "design_heuristic",
          "notes": "Настраиваемая проектная цель; не обязательная строительная норма.",
          "enforcement": "soft"
        },
        {
          "id": "bed_side",
          "related_rule_ids": [
            "BED004"
          ],
          "values": {
            "recommendation_floor": 600,
            "target_range": [
              800,
              900
            ]
          },
          "unit": "mm",
          "measurement": "От внешнего бока каркаса на рабочем участке подхода до ближайшего препятствия.",
          "basis": "design_heuristic",
          "notes": "600 мм — ограниченный исходный ориентир; не цель большого дома и не доказательство доступности.",
          "enforcement": "soft"
        },
        {
          "id": "bed_foot",
          "related_rule_ids": [
            "BED005"
          ],
          "values": {
            "target_range": [
              800,
              1000
            ]
          },
          "unit": "mm",
          "measurement": "От внешнего изножья до ближайшего препятствия; если есть банкетка, от ее внешней грани.",
          "basis": "design_heuristic",
          "notes": "Настраиваемая проектная цель; не обязательная строительная норма.",
          "enforcement": "soft"
        },
        {
          "id": "wardrobe_working_aisle",
          "related_rule_ids": [
            "WARD003"
          ],
          "values": {
            "target_range": [
              1000,
              1200
            ]
          },
          "unit": "mm",
          "measurement": "Между наиболее выступающими закрытыми фасадами и препятствием; открытые ящики проверяются отдельно.",
          "basis": "design_heuristic",
          "notes": "Настраиваемая проектная цель; не обязательная строительная норма.",
          "enforcement": "soft"
        },
        {
          "id": "sofa_coffee_table",
          "related_rule_ids": [
            "LIV007"
          ],
          "values": {
            "target_range": [
              400,
              500
            ]
          },
          "unit": "mm",
          "measurement": "От передней наружной кромки дивана до столика; это зона пользования, не главный транзит.",
          "basis": "design_heuristic",
          "notes": "Настраиваемая проектная цель; не обязательная строительная норма.",
          "enforcement": "soft"
        },
        {
          "id": "dining_table_to_obstruction",
          "related_rule_ids": [
            "DIN004"
          ],
          "values": {
            "target_range": [
              1300,
              1500
            ]
          },
          "unit": "mm",
          "measurement": "От края столешницы до препятствия за сидящим, включая посадку и проход.",
          "basis": "published_guideline",
          "notes": "Рекомендация IKEA для более комфортного прохода. Не остаточная ширина за спинкой.",
          "enforcement": "soft"
        },
        {
          "id": "dining_frontage",
          "related_rule_ids": [
            "DIN002"
          ],
          "values": {
            "target_range": [
              650,
              750
            ]
          },
          "unit": "mm",
          "measurement": "Свободный фронт столешницы на одного человека; проверять подлокотники/ножки/ширину реального пользователя.",
          "basis": "design_heuristic",
          "notes": "Настраиваемая проектная цель; не обязательная строительная норма.",
          "enforcement": "soft"
        },
        {
          "id": "kitchen_reference",
          "related_rule_ids": [
            "KIT004"
          ],
          "values": {
            "one_cook_reference": 1067,
            "multiple_cooks_reference": 1219
          },
          "unit": "mm",
          "measurement": "Между фронтами столешниц, высоких шкафов и техники.",
          "basis": "published_guideline",
          "notes": "NKBA: рекомендации, не местные нормы; состояния дверей и операторов проверять отдельно.",
          "enforcement": "soft"
        },
        {
          "id": "kitchen_large_house",
          "related_rule_ids": [
            "KIT004"
          ],
          "values": {
            "target_range": [
              1200,
              1400
            ]
          },
          "unit": "mm",
          "measurement": "Та же метрика рабочих фронтов; не считать больший проход бесконечно полезным.",
          "basis": "design_heuristic",
          "notes": "Настраиваемая проектная цель; не обязательная строительная норма.",
          "enforcement": "soft"
        },
        {
          "id": "bath_front",
          "related_rule_ids": [
            "BATH002"
          ],
          "values": {
            "target_range": [
              900,
              1200
            ]
          },
          "unit": "mm",
          "measurement": "От переднего края прибора до встречного препятствия; доступность имеет свои дополнительные шаблоны.",
          "basis": "design_heuristic",
          "notes": "Настраиваемая проектная цель; не обязательная строительная норма.",
          "enforcement": "soft"
        },
        {
          "id": "shower_seed",
          "related_rule_ids": [
            "BATH006"
          ],
          "values": {
            "width_target": 1000,
            "depth_target": 1200
          },
          "unit": "mm",
          "measurement": "Между готовыми внутренними поверхностями душа, без вычета толщины стен второй раз.",
          "basis": "design_heuristic",
          "notes": "Настраиваемая проектная цель; не обязательная строительная норма.",
          "enforcement": "soft"
        },
        {
          "id": "office_pullback",
          "related_rule_ids": [
            "OFF010"
          ],
          "values": {
            "target_range": [
              900,
              1100
            ]
          },
          "unit": "mm",
          "measurement": "От передней рабочей кромки стола назад по оси кресла до препятствия; проход за сидящим отдельно.",
          "basis": "design_heuristic",
          "notes": "Настраиваемая проектная цель; не обязательная строительная норма.",
          "enforcement": "soft"
        },
        {
          "id": "monitor_viewing",
          "related_rule_ids": [
            "OFF002"
          ],
          "values": {
            "target_range": [
              500,
              1000
            ]
          },
          "unit": "mm",
          "measurement": "От глаза до передней плоскости экрана.",
          "basis": "published_guideline",
          "notes": "OSHA: ориентир рабочего места, адаптируется под пользователя/шрифт; не обязательная норма частного дома.",
          "enforcement": "soft"
        }
      ]
    },
    {
      "id": "nkba_recommendations_reference",
      "enabled": true,
      "scope": "Только опубликованные рекомендации, не исторические code requirements из тех же PDF.",
      "source_ids": [
        "ROOM-S06",
        "SERVICE-S02"
      ]
    },
    {
      "id": "accessibility_ada_reference",
      "enabled": false,
      "scope": "Выбранные справочные ADA-проверки. Полная применимость и дополнительные таблицы подлежат отдельной реализации.",
      "compliance_claim_allowed": false
    },
    {
      "id": "KG_residential_regulatory",
      "enabled": null,
      "status": "pending_external_validation",
      "jurisdiction": "Кыргызская Республика",
      "source_ids": [
        "ROOT-S03"
      ],
      "scope": "Нужен полный проверенный текст актуальных требований по конкретному проекту; численные нормативы не импортированы."
    },
    {
      "id": "relevant_manufacturer_constraints",
      "enabled": true,
      "scope": "При наличии изделия активировать его проверки; неизвестная модель/паспорт дает unknown."
    }
  ],
  "initial_score_weights": {
    "circulation": 0.2,
    "daily_tasks": 0.2,
    "ergonomics": 0.2,
    "daylight_and_views": 0.1,
    "privacy_and_acoustics": 0.1,
    "storage_and_service": 0.1,
    "composition": 0.1
  },
  "score_policy": "Только среди вариантов без hard fail; coverage и hard unknown сообщать отдельно. До использования обучить/настроить шкалы и веса. Итоговый балл не является доказательством идеальности.",
  "overlap_policy": [
    {
      "pair": [
        "physical",
        "physical"
      ],
      "policy": "Запрещено пересечение твердых 3D-тел; касание/сопряжение допускается по модели."
    },
    {
      "pair": [
        "opening",
        "physical"
      ],
      "policy": "Проверить swept volume в требуемом состоянии."
    },
    {
      "pair": [
        "use",
        "use"
      ],
      "policy": "Разрешено при совместимых телах и действиях; иначе разнести по времени, если сценарий допускает."
    },
    {
      "pair": [
        "approach",
        "approach"
      ],
      "policy": "Один пользователь может подходить по очереди; одновременных проверить отдельно."
    },
    {
      "pair": [
        "service",
        "use"
      ],
      "policy": "Возможна отдельная сервисная конфигурация с разрешенными штатными преобразованиями."
    },
    {
      "pair": [
        "preferred",
        "any"
      ],
      "policy": "Мягкая оценка по смыслу предпочтения."
    },
    {
      "pair": [
        "regulatory_clearance",
        "any"
      ],
      "policy": "Только правила выбранного профиля; общее разрешение перекрытий не применяется."
    }
  ],
  "six_object_envelopes": [
    "physical_volume",
    "opening_zone",
    "use_zone",
    "approach_zone",
    "service_zone",
    "preferred_zone"
  ]
});
export const LAYOUT_PROFILES = LAYOUT_PROFILE_SETTINGS.profiles;

export const LAYOUT_EVALUATOR_LIBRARY = deepFreeze({
  "metadata": {
    "status": "implementation_contracts_not_implemented",
    "count": 23
  },
  "evaluators": [
    {
      "id": "polygon_validity",
      "example_rule_ids": [
        "GEO001"
      ],
      "required_inputs": [
        "rings",
        "coordinate_units"
      ],
      "algorithm_contract": "Проверить замкнутость, площадь, самопересечения, вложенность отверстий; точность не заменяет реальный допуск.",
      "returns": [
        "validity",
        "invalid_edges"
      ],
      "implementation_kind": "deterministic_geometry",
      "status": "specification_only"
    },
    {
      "id": "support_and_containment",
      "example_rule_ids": [
        "GEO006",
        "GEO018"
      ],
      "required_inputs": [
        "room_floor_mesh",
        "voids",
        "object_support_contacts"
      ],
      "algorithm_contract": "Проверить опору каждого контакта и объем внутри доступного пространства; отверстия второго света вычтены.",
      "returns": [
        "support_status",
        "outside_parts"
      ],
      "implementation_kind": "deterministic_geometry",
      "status": "specification_only"
    },
    {
      "id": "solid_collision_3d",
      "example_rule_ids": [
        "GEO004",
        "GEO005"
      ],
      "required_inputs": [
        "physical_volumes_per_state",
        "transforms"
      ],
      "algorithm_contract": "Broad-phase AABB, затем реальная 3D/многослойная narrow-phase; исключения сопряжений явные.",
      "returns": [
        "collision_pairs",
        "intersection_geometry"
      ],
      "implementation_kind": "deterministic_geometry",
      "status": "specification_only"
    },
    {
      "id": "swept_opening",
      "example_rule_ids": [
        "GEO008",
        "GEO009",
        "KIT025"
      ],
      "required_inputs": [
        "kinematic_model",
        "required_angle_or_extension",
        "obstacles"
      ],
      "algorithm_contract": "Проверить весь непрерывный ход либо консервативную ограниченную дискретизацию с доказанным запасом.",
      "returns": [
        "collision_intervals",
        "reachable_open_fraction"
      ],
      "implementation_kind": "deterministic_geometry",
      "status": "specification_only"
    },
    {
      "id": "activity_space",
      "example_rule_ids": [
        "GEO013",
        "GEO014",
        "BED003"
      ],
      "required_inputs": [
        "actor_footprint",
        "posture",
        "item_state",
        "approach_zones"
      ],
      "algorithm_contract": "Совместить тело, позу, опоры и пространство действия; проверять вставание/посадку, не только позу.",
      "returns": [
        "reachable",
        "collision",
        "clearance"
      ],
      "implementation_kind": "deterministic_geometry",
      "status": "specification_only"
    },
    {
      "id": "navmesh_connectivity",
      "example_rule_ids": [
        "PATH001",
        "PATH002"
      ],
      "required_inputs": [
        "free_space",
        "agent_geometry",
        "doors",
        "level_connectors"
      ],
      "algorithm_contract": "Configuration-space/navmesh либо search в SE(2) для ориентируемого тела. Учесть форму и этаж.",
      "returns": [
        "path_exists",
        "path",
        "path_length"
      ],
      "implementation_kind": "deterministic_geometry",
      "status": "specification_only"
    },
    {
      "id": "bottleneck",
      "example_rule_ids": [
        "PATH004",
        "PATH020"
      ],
      "required_inputs": [
        "validated_path",
        "occupied_obstacles",
        "measurement_definition"
      ],
      "algorithm_contract": "Найти минимум по пути, координату и длину сужения; средняя ширина не годится.",
      "returns": [
        "min_width",
        "location",
        "segment_length"
      ],
      "implementation_kind": "deterministic_geometry",
      "status": "specification_only"
    },
    {
      "id": "time_expanded_access",
      "example_rule_ids": [
        "GEO015",
        "GEO016",
        "KIT006"
      ],
      "required_inputs": [
        "states",
        "transitions",
        "actors",
        "concurrency",
        "profile_exclusions"
      ],
      "algorithm_contract": "Проверить доступную последовательность открытия/закрытия без trapping; не обходить запреты профиля.",
      "returns": [
        "state_sequence",
        "exit_reachable",
        "conflicts"
      ],
      "implementation_kind": "deterministic_geometry",
      "status": "specification_only"
    },
    {
      "id": "occupied_seating",
      "example_rule_ids": [
        "DIN003",
        "PATH007",
        "KIT035"
      ],
      "required_inputs": [
        "table_edge",
        "chair_and_user_state",
        "obstacle"
      ],
      "algorithm_contract": "Измерять table_to_obstruction и residual_walkway раздельно, с указанием позы.",
      "returns": [
        "total_depth",
        "occupied_depth",
        "residual_walkway"
      ],
      "implementation_kind": "deterministic_geometry",
      "status": "specification_only"
    },
    {
      "id": "reachability",
      "example_rule_ids": [
        "OFF006",
        "WARD011"
      ],
      "required_inputs": [
        "body_model",
        "working_pose",
        "control_location",
        "obstacles"
      ],
      "algorithm_contract": "Проверить досягаемость без пересечения тела и неудобной позы; применимые профили отдельно.",
      "returns": [
        "reachable",
        "posture_cost"
      ],
      "implementation_kind": "deterministic_geometry",
      "status": "specification_only"
    },
    {
      "id": "visibility_rays",
      "example_rule_ids": [
        "VIS001",
        "LIV011",
        "PRIV001"
      ],
      "required_inputs": [
        "eye_poses",
        "targets",
        "3D_occluders"
      ],
      "algorithm_contract": "Лучевой тест по реальным глазам; доля видимой цели — проектная метрика без универсального порога.",
      "returns": [
        "visible_fraction",
        "occluders",
        "view_angle"
      ],
      "implementation_kind": "deterministic_geometry",
      "status": "specification_only"
    },
    {
      "id": "solar_and_glare",
      "example_rule_ids": [
        "LGT004",
        "LGT006"
      ],
      "required_inputs": [
        "geolocation",
        "north",
        "time",
        "window_geometry",
        "external_obstacles",
        "reflectance",
        "eye_pose"
      ],
      "algorithm_contract": "Трассировка солнца и отражений. Без фотометрии только маркированный качественный риск, не расчет UGR/DGP.",
      "returns": [
        "sun_intervals",
        "qualitative_glare_risk"
      ],
      "implementation_kind": "simulation",
      "status": "specification_only"
    },
    {
      "id": "photometric_adapter",
      "example_rule_ids": [
        "LGT018",
        "LGT024"
      ],
      "required_inputs": [
        "IES_LDT",
        "luminaire_flux",
        "geometry",
        "reflectances",
        "task_planes"
      ],
      "algorithm_contract": "Внешний светотехнический расчет с сохранением плоскостей, коэффициентов и версии входа.",
      "returns": [
        "illuminance",
        "uniformity",
        "glare_if_supported"
      ],
      "implementation_kind": "external_calculation",
      "status": "specification_only"
    },
    {
      "id": "acoustic_adapter",
      "example_rule_ids": [
        "ACOU004",
        "ACOU005"
      ],
      "required_inputs": [
        "assembly_specs",
        "source_levels",
        "flanking_paths",
        "absorptions"
      ],
      "algorithm_contract": "Акустический расчет/измерение; отдельно реверберация и межкомнатная изоляция.",
      "returns": [
        "supported_acoustic_metrics"
      ],
      "implementation_kind": "external_calculation",
      "status": "specification_only"
    },
    {
      "id": "manufacturer_clearances",
      "example_rule_ids": [
        "SPA002",
        "KIT018",
        "CLIM005"
      ],
      "required_inputs": [
        "exact_model",
        "manual_revision",
        "installed_configuration"
      ],
      "algorithm_contract": "Извлечь требование из паспорта и проверить его конкретную геометрию. Без модели unknown.",
      "returns": [
        "clearance_checks",
        "manual_reference"
      ],
      "implementation_kind": "catalog_and_geometry",
      "status": "specification_only"
    },
    {
      "id": "capacity",
      "example_rule_ids": [
        "LIV002",
        "DIN001"
      ],
      "required_inputs": [
        "seat_geometry",
        "actor_profiles",
        "mandatory_counts"
      ],
      "algorithm_contract": "Подсчитать только достижимые пригодные места; число иконок стульев не равно вместимости.",
      "returns": [
        "usable_count",
        "unusable_seats"
      ],
      "implementation_kind": "deterministic_geometry",
      "status": "specification_only"
    },
    {
      "id": "storage_capacity",
      "example_rule_ids": [
        "WARD001",
        "STORE003"
      ],
      "required_inputs": [
        "inventory",
        "usable_shelf_volumes",
        "door_kinematics"
      ],
      "algorithm_contract": "Проверить полезный объем и доступ по категории, массу/досягаемость отдельно.",
      "returns": [
        "required_provided",
        "unreachable_storage"
      ],
      "implementation_kind": "deterministic_geometry",
      "status": "specification_only"
    },
    {
      "id": "delivery_path",
      "example_rule_ids": [
        "GEO019",
        "SERV007"
      ],
      "required_inputs": [
        "package_geometry",
        "approved_disassembly",
        "route_3D"
      ],
      "algorithm_contract": "Проверить перенос и повороты; для сложных лестниц SE(3) либо подтвержденная процедура.",
      "returns": [
        "transport_feasible",
        "assembly_sequence"
      ],
      "implementation_kind": "deterministic_geometry",
      "status": "specification_only"
    },
    {
      "id": "load_and_fixing",
      "example_rule_ids": [
        "STORE005",
        "SAFE001"
      ],
      "required_inputs": [
        "rated_load",
        "actual_load",
        "fixing_spec",
        "substrate"
      ],
      "algorithm_contract": "Сверить нагрузку и проект крепления; неизвестное основание требует внешней проверки.",
      "returns": [
        "load_margin",
        "fixing_status"
      ],
      "implementation_kind": "manufacturer_or_external",
      "status": "specification_only"
    },
    {
      "id": "profile_lookup",
      "example_rule_ids": [
        "ACC001",
        "IN020"
      ],
      "required_inputs": [
        "jurisdiction",
        "building_scope",
        "selected_profile",
        "source_version"
      ],
      "algorithm_contract": "Активировать только применимые пункты, их исключения и зависимые таблицы; не комбинировать версии.",
      "returns": [
        "active_constraints",
        "missing_tables"
      ],
      "implementation_kind": "profile_engine",
      "status": "specification_only"
    },
    {
      "id": "robust_threshold",
      "example_rule_ids": [
        "GEO017",
        "QA011"
      ],
      "required_inputs": [
        "measurement",
        "uncertainty_bound",
        "threshold"
      ],
      "algorithm_contract": "Для g±e: pass если g-e>=t; fail если g+e<t; иначе unknown. Статистические интервалы не подменять твердым bound.",
      "returns": [
        "status",
        "lower_bound",
        "upper_bound"
      ],
      "implementation_kind": "deterministic_geometry",
      "status": "specification_only"
    },
    {
      "id": "scenario_coordinator",
      "example_rule_ids": [
        "SCN001",
        "SCN004",
        "SCN014"
      ],
      "required_inputs": [
        "actors",
        "states",
        "task_graph",
        "concurrency"
      ],
      "algorithm_contract": "Запустить связанные валидаторы для выбранных одновременных состояний; комфорт остается soft.",
      "returns": [
        "required_results",
        "comfort_results",
        "unresolved_inputs"
      ],
      "implementation_kind": "orchestration",
      "status": "specification_only"
    },
    {
      "id": "score_composer",
      "example_rule_ids": [
        "OPT001",
        "OPT011",
        "OPT012"
      ],
      "required_inputs": [
        "hard_results",
        "soft_metrics",
        "weights",
        "fixed_scales",
        "coverage"
      ],
      "algorithm_contract": "Сначала feasibility; затем нормированная utility с насыщением; одинаковая база сравнения, unknown отдельно.",
      "returns": [
        "rank",
        "score",
        "coverage",
        "pareto_tradeoffs"
      ],
      "implementation_kind": "optimisation",
      "status": "specification_only"
    }
  ]
});
export const LAYOUT_EVALUATOR_SPECS = LAYOUT_EVALUATOR_LIBRARY.evaluators;

export const LAYOUT_KNOWLEDGE_STATS = deepFreeze({
  "scenarios": 20,
  "profiles": 6,
  "evaluators": 23,
  "evaluatorKinds": {
    "deterministic_geometry": 15,
    "simulation": 1,
    "external_calculation": 2,
    "catalog_and_geometry": 1,
    "manufacturer_or_external": 1,
    "profile_engine": 1,
    "orchestration": 1,
    "optimisation": 1
  }
});

const SCENARIO_INDEX = new Map(LAYOUT_SCENARIOS.map((entry) => [entry.scenario_id, entry]));
const PROFILE_INDEX = new Map(LAYOUT_PROFILES.map((entry) => [entry.id, entry]));
const EVALUATOR_INDEX = new Map(LAYOUT_EVALUATOR_SPECS.map((entry) => [entry.id, entry]));

export function layoutScenarioById(id) {
  return SCENARIO_INDEX.get(id) || null;
}

export function layoutProfileById(id) {
  return PROFILE_INDEX.get(id) || null;
}

export function layoutEvaluatorById(id) {
  return EVALUATOR_INDEX.get(id) || null;
}
