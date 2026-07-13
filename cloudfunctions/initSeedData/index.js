const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  const results = { success: true, created: [], skipped: [] };

  try {
    // 1. 创建质检工段模板（幂等：已存在则跳过）
    const existingTpl = await db.collection('process_templates').where({ template_id: 'TPL_QC_01' }).get();
    if (existingTpl.data.length === 0) {
      const tplRes = await db.collection('process_templates').add({
        data: {
          template_id: 'TPL_QC_01',
          template_name: '质检工段填报模板',
          step_name: '质检工段',
          fields: [
            { field_name: 'outer_diameter', label: '外径尺寸', type: 'number', required: true, unit: 'mm' },
            { field_name: 'inner_diameter', label: '内径尺寸', type: 'number', required: true, unit: 'mm' },
            { field_name: 'thickness', label: '壁厚', type: 'number', required: false, unit: 'mm' },
            { field_name: 'appearance_result', label: '外观检查结果', type: 'radio', required: true, options: ['合格', '返修', '报废'] },
            { field_name: 'surface_defect', label: '表面缺陷描述', type: 'textarea', required: false },
            { field_name: 'need_rework', label: '是否需要返工', type: 'switch', required: false }
          ],
          created_at: db.serverDate()
        }
      });
      results.created.push({ collection: 'process_templates', id: tplRes._id });
    } else {
      results.skipped.push('process_templates: TPL_QC_01 已存在');
    }

    // 2. 创建测试流程卡（幂等）
    const seedCards = [
      { card_no: 'WO-20260712-01', prod_name: '轴承外圈加工' },
      { card_no: 'WO-20260712-02', prod_name: '轴承内圈加工' }
    ];

    for (const c of seedCards) {
      const existCard = await db.collection('process_cards').where({ card_no: c.card_no }).get();
      if (existCard.data.length === 0) {
        const cardRes = await db.collection('process_cards').add({
          data: {
            card_no: c.card_no,
            prod_name: c.prod_name,
            current_step: '质检工段',
            template_id: 'TPL_QC_01',
            status: '加工中',
            is_locked: false,
            locked_by: '',
            lock_time: null,
            created_at: db.serverDate()
          }
        });
        results.created.push({ collection: 'process_cards', id: cardRes._id, card_no: c.card_no });
      } else {
        results.skipped.push('process_cards: ' + c.card_no + ' 已存在');
      }
    }

    results.msg = '初始化完成。测试卡号：WO-20260712-01 / WO-20260712-02';
    return results;
  } catch (err) {
    return { success: false, msg: '初始化失败：' + (err.errMsg || err.message || '未知错误'), error: err };
  }
};
