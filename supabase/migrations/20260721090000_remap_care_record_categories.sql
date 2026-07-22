update public.care_record_items
set
  category = case category
    when 'health_insurance' then 'health_care'
    when 'support_government' then 'support_services'
    when 'financial_advisors' then 'financial_resources'
    else category
  end,
  updated_at = now()
where category in ('health_insurance', 'support_government', 'financial_advisors');
