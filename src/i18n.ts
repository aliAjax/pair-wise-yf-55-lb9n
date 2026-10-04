import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

i18n.use(initReactI18next).init({
  lng: 'zh',
  resources: { zh: { translation: { title: '规则编排与对账口径模拟平台', publish: '发布会话', simulate: '迁移模拟', runtime: '运行态表单', navForm: '表单编排', navRecon: '对账口径' } } }
});

export default i18n;
