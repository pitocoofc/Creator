import express from 'express';
import bcrypt from 'bcryptjs';
import cors from 'cors';

const app = express();

app.use(cors());
app.use(express.json());

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO;

// Rota de teste
app.get('/', (req, res) => {
    return res.status(200).send("Serviço de Login ativo e operante!");
});

// ----------------------------------------------------
// ROTA POST: /login
// ----------------------------------------------------
app.post('/login', async (req, res) => {
    const { usuario, senha } = req.body;

    if (!usuario || !senha) {
        return res.status(400).json({ erro: "Usuário e senha são obrigatórios." });
    }

    const usuarioFormatado = usuario.toLowerCase().trim();

    try {
        // 1. Buscar os dados da conta no GitHub
        const fileName = `contas/${usuarioFormatado}.json`;
        const urlGithub = `https://api.github.com/repos/${GITHUB_REPO}/contents/${fileName}`;

        const respostaGithub = await fetch(urlGithub, {
            headers: {
                "Authorization": `Bearer ${GITHUB_TOKEN}`,
                "Accept": "application/vnd.github.v3+json",
                "User-Agent": "Render-Login-Service"
            }
        });

        if (respostaGithub.status === 404) {
            return res.status(404).json({ erro: "Usuário não encontrado." });
        }

        if (!respostaGithub.ok) {
            return res.status(500).json({ erro: "Erro ao consultar base de dados." });
        }

        const dadosGithub = await respostaGithub.json();
        
        // Decodificar o JSON salvo no GitHub (Base64)
        const conteudoJson = Buffer.from(dadosGithub.content, 'base64').toString('utf-8');
        const conta = JSON.parse(conteudoJson);

        // 2. Verificar se a senha confere
        const senhaCorreta = await bcrypt.compare(senha, conta.senha);
        if (!senhaCorreta) {
            return res.status(401).json({ erro: "Senha incorreta." });
        }

        // 3. Gerar a conta de soma com números maiores que 15.000
        const min = 15001;
        const max = 99999;
        const num1 = Math.floor(Math.random() * (max - min + 1)) + min;
        const num2 = Math.floor(Math.random() * (max - min + 1)) + min;
        const resultadoSoma = num1 + num2;

        // 4. Retornar usuário, data de criação e a conta de soma
        return res.status(200).json({
            mensagem: "Login realizado com sucesso!",
            usuario: conta.usuario,
            criadoEm: conta.criadoEm,
            desafioSoma: {
                num1,
                num2,
                expressao: `${num1} + ${num2}`,
                resultadoEsperado: resultadoSoma
            }
        });

    } catch (err) {
        console.error("[ERRO LOGIN]", err);
        return res.status(500).json({ erro: "Erro interno no servidor ao processar o login." });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor de Login rodando na porta ${PORT}`));
