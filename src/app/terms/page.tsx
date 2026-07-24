export const metadata = {
  title: 'Termos de Serviço — Brand',
  description: 'Termos de serviço do aplicativo IA News BR API utilizado pela Brand.',
}

export default function TermsPage() {
  return (
    <main style={{
      maxWidth: 760,
      margin: '0 auto',
      padding: '60px 24px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      color: '#1a1a1a',
      lineHeight: 1.7,
    }}>
      <h1 style={{ fontSize: 32, fontWeight: 700, marginBottom: 8 }}>Termos de Serviço</h1>
      <p style={{ color: '#666', marginBottom: 40 }}>
        Última atualização: {new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}
      </p>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 12 }}>1. Sobre o aplicativo</h2>
        <p>
          O <strong>IA News BR API</strong> é um aplicativo interno operado pela
          <strong> Brand Eletromobilidade</strong> para automatizar a publicação de
          conteúdo informativo sobre mobilidade elétrica e energia renovável nas redes sociais
          da empresa. O aplicativo integra as APIs do Meta (Instagram e Facebook) exclusivamente
          para uso corporativo da Brand.
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 12 }}>2. Uso do aplicativo</h2>
        <p>
          O aplicativo é de uso exclusivo da equipe da Brand. Não é disponibilizado
          ao público em geral nem permite cadastro de usuários externos. O acesso é
          restrito a administradores autorizados.
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 12 }}>3. Permissões e acesso</h2>
        <p>
          O aplicativo solicita acesso às APIs do Instagram e Facebook para realizar as
          seguintes operações em nome da conta de negócios da Brand:
        </p>
        <ul style={{ paddingLeft: 24, marginTop: 8 }}>
          <li>Publicação de posts, Reels e Stories no Instagram</li>
          <li>Leitura de métricas e insights da conta</li>
          <li>Curadoria de conteúdo público de outras contas de negócios</li>
        </ul>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 12 }}>4. Responsabilidades</h2>
        <p>
          A Brand é responsável pelo uso adequado das APIs do Meta conforme os
          Termos de Serviço da plataforma. O conteúdo publicado por meio do aplicativo
          é de responsabilidade editorial da Brand.
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 12 }}>5. Dados e privacidade</h2>
        <p>
          O tratamento de dados segue nossa{' '}
          <a href="/privacy" style={{ color: '#8B35FF' }}>Política de Privacidade</a>.
          Não coletamos dados pessoais de terceiros além do necessário para operação
          das funcionalidades descritas.
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 12 }}>6. Alterações</h2>
        <p>
          Estes termos podem ser atualizados periodicamente. A data de última atualização
          será sempre indicada no topo da página.
        </p>
      </section>

      <section style={{ marginBottom: 48 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 12 }}>7. Contato</h2>
        <p>
          <a href="mailto:contato@your-company.example" style={{ color: '#8B35FF' }}>
            contato@your-company.example
          </a>
          <br />
          <a href="https://your-company.example" style={{ color: '#8B35FF' }}>
            your-company.example
          </a>
        </p>
      </section>

      <hr style={{ borderColor: '#eee', marginBottom: 24 }} />
      <p style={{ color: '#999', fontSize: 14 }}>
        © {new Date().getFullYear()} Brand Eletromobilidade.{' '}
        <a href="/privacy" style={{ color: '#8B35FF' }}>Política de Privacidade</a>
      </p>
    </main>
  )
}
