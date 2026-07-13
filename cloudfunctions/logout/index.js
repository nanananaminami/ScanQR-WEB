const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  const { session_token } = event;
  if (!session_token) return { success: true };
  try {
    await db.collection('sys_sessions').where({ session_token }).remove();
  } catch (e) {}
  return { success: true };
};
