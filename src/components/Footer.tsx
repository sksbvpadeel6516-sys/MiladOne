export default function Footer() {
    return (
        <footer className="app-footer">
            <p className="app-footer-text">
                Developed by{' '}
                <span className="app-footer-brand">MeridianTech</span>
                {' '}·{' '}
                <span>MiladOne</span>
                {' '}·{' '}
                <span>© {new Date().getFullYear()}</span>
            </p>
        </footer>
    );
}
