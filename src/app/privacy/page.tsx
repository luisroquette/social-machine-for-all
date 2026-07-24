export const metadata = {
  title: 'Política de Privacidade — Brand',
  description: 'Política de privacidade do aplicativo IA News BR API utilizado pela Brand.',
}

export default function PrivacyPage() {
  return (
    <main style={{
      maxWidth: 760,
      margin: '0 auto',
      padding: '60px 24px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      color: '#1a1a1a',
      lineHeight: 1.7,
    }}>
      <h1 style={{ fontSize: 32, fontWeight: 700, marginBottom: 8 }}>Política de Privacidade</h1>
      <p style={{ color: '#666', marginBottom: 40 }}>
        Última atualização: {new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}
      </p>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 12 }}>1. Quem somos</h2>
        <p>
          Este aplicativo (<strong>IA News BR API</strong>) é operado pela <strong>Brand Eletromobilidade</strong>,
          empresa especializada em soluções de mobilidade elétrica e infraestrutura de recarga.
          O aplicativo é utilizado para automatizar a publicação de conteúdo informativo sobre
          veículos elétricos e energia renovável nas redes sociais da Brand.
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 12 }}>2. Dados coletados</h2>
        <p>O aplicativo acessa as seguintes informações por meio das APIs do Meta (Facebook/Instagram):</p>
        <ul style={{ paddingLeft: 24, marginTop: 8 }}>
          <li>Dados da conta de negócios do Instagram da Brand (ID, username, métricas de alcance)</li>
          <li>Tokens de acesso OAuth necessários para publicação de conteúdo</li>
          <li>Dados públicos de contas de negócios do Instagram monitoradas para curadoria de conteúdo</li>
        </ul>
        <p style={{ marginTop: 12 }}>
          O aplicativo <strong>não coleta dados pessoais de usuários finais</strong> e não armazena
          informações de terceiros além do necessário para operação das funcionalidades descritas.
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 12 }}>3. Uso dos dados</h2>
        <p>Os dados acessados são utilizados exclusivamente para:</p>
        <ul style={{ paddingLeft: 24, marginTop: 8 }}>
          <li>Publicação automática de posts e Reels na conta oficial do Instagram da Brand</li>
          <li>Curadoria de conteúdo público sobre mobilidade elétrica</li>
          <li>Análise de desempenho de publicações (insights)</li>
        </ul>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 12 }}>4. Compartilhamento de dados</h2>
        <p>
          Não compartilhamos dados com terceiros. Os tokens de acesso são armazenados de forma
          segura e utilizados apenas para as operações descritas nesta política.
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 12 }}>5. Retenção e exclusão</h2>
        <p>
          Os tokens de acesso são mantidos enquanto o aplicativo estiver em uso. Para solicitar
          a remoção dos seus dados ou revogar o acesso do aplicativo, entre em contato pelo
          e-mail abaixo ou revogue as permissões diretamente nas configurações do Instagram/Facebook.
        </p>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 12 }}>6. Segurança</h2>
        <p>
          Adotamos medidas técnicas para proteger os dados acessados, incluindo armazenamento
          criptografado de credenciais e comunicação via HTTPS.
        </p>
      </section>

      <section style={{ marginBottom: 48 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 12 }}>7. Contato</h2>
        <p>
          Para dúvidas sobre esta política ou solicitações relacionadas a dados:
          <br />
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
        © {new Date().getFullYear()} Brand Eletromobilidade. Todos os direitos reservados.
      </p>
    </main>
  )
}
