import { AppBar, Box, Button, Toolbar, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, Route, Routes } from 'react-router-dom';
import FormSimulatorPage from './pages/FormSimulatorPage';
import ReconPage from './pages/ReconPage';

export default function App() {
  const { t } = useTranslation();
  return (
    <Box minHeight="100vh" bgcolor="#f7f8fc">
      <AppBar position="sticky" color="primary">
        <Toolbar>
          <Typography variant="h6" flexGrow={1}>{t('title')}</Typography>
          <Button color="inherit" component={Link} to="/">{t('navForm')}</Button>
          <Button color="inherit" component={Link} to="/recon">{t('navRecon')}</Button>
        </Toolbar>
      </AppBar>
      <Routes>
        <Route path="/" element={<FormSimulatorPage />} />
        <Route path="/recon" element={<ReconPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Box>
  );
}
