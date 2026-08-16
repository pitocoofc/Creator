import express from 'express';
import bcrypt from 'bcryptjs';
import cors from 'cors';
import multer from 'multer';
import { compressFull, decompressFull } from './compression.js';

const app = express();
app.use(cors());
app.use(express.json());

// Limite estrito de 5 KB por arquivo
const upload = multer({
  limits: { fileSize: 5 * 1024 } // 5120 bytes
});

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO;

// Importante para referenciar a fila de cadastros caso o serviço rode no mesmo processo
// ou se for consulta direta no GitHub/RAM externa
const headersGitHub = {
  "Authorization": `Bearer ${GITHUB_TOKEN}`,
  "Accept": "application/vnd.github.v3+json",
  "User-Agent": "Render-Storage-Service"
};

// --- HELPER: Autentica o usuário checando no GitHub ou na fila ---
async function autenticarUsuario(usuario, senha) {
  if (!usuario || !senha) return false;
  const usuarioFormatado = usuario.toLowerCase().trim();

  try {
    // 1. Tenta buscar a conta gravada no GitHub: contas/<usuario>.json
    const urlGithub = `https://api.github.com/repos/${GITHUB_REPO}/contents/contas/${usuarioFormatado}.json`;
    const resGithub = await fetch(urlGithub, { headers: headersGitHub });

    let hashSenhaSalvo = null;

    if (resGithub.status === 200) {
      const data = await resGithub.json();
      const contaJson = JSON.parse(Buffer.from(data.content, 'base64').toString('utf8'));
      hashSenhaSalvo = contaJson.senha;
    } else {
      // Conta não existe no GitHub
      return false;
    }

    // 2. Compara a senha em texto puro com o Hash Bcrypt salvo
    return await bcrypt.compare(senha, hashSenhaSalvo);

  } catch (err) {
    console.error(`[ERRO AUTENTICACAO] Falha ao verificar @${usuario}:`, err);
    return false;
  }
}

// --- HELPER: Busca e descompacta arquivo .ndj do repositório ---
async function buscarEBaixarArquivoNdj(caminhoGithub) {
  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${caminhoGithub}`;
  const res = await fetch(url, { headers: headersGitHub });

  if (!res.ok) return null;

  const data = await res.json();
  const fullBuffer = Buffer.from(data.content, 'base64');

  // Desmonta cabeçalho personalizado
  const headerLen = fullBuffer[0];
  const nomeOriginal = fullBuffer.subarray(1, 1 + headerLen).toString('utf8');
  const dadosComprimidos = fullBuffer.subarray(1 + headerLen);

  // Descompacta com LZ77 + Huffman
  const bufferOriginal = decompressFull(dadosComprimidos);

  return {
    nomeOriginal,
    bufferOriginal,
    sha: data.sha
  };
}

// ====================================================
// ROTA POST: /storage/upload (Gravar Armazenamento Extra)
// ====================================================
app.post('/storage/upload', upload.single('file'), async (req, res) => {
  try {
    const { usuario, senha } = req.body;

    if (!usuario || !senha) {
      return res.status(400).json({ erro: "Usuário e senha são obrigatórios." });
    }

    // 1. Validação de Credenciais com Bcrypt
    const credenciaisValidas = await autenticarUsuario(usuario, senha);
    if (!credenciaisValidas) {
      return res.status(401).json({ erro: "Credenciais inválidas ou conta não cadastrada." });
    }

    // 2. Validação do arquivo de upload (Limite de 5KB e extensões)
    if (!req.file) {
      return res.status(400).json({ erro: "Nenhum arquivo enviado ou excede o limite de 5KB." });
    }

    const fileName = req.file.originalname;
    const fileExt = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();

    if (fileExt !== '.json' && fileExt !== '.txt') {
      return res.status(400).json({ erro: "Apenas arquivos .json e .txt são permitidos." });
    }

    const usuarioFormatado = usuario.toLowerCase().trim();

    // 3. Compactação (LZ77 + Huffman)
    const compressedBuffer = compressFull(req.file.buffer);

    // Header interno com tamanho e nome do arquivo original
    const nameBytes = Buffer.from(fileName, 'utf8');
    const headerLen = Buffer.from([nameBytes.length]);
    const finalBuffer = Buffer.concat([headerLen, nameBytes, compressedBuffer]);

    const base64Content = finalBuffer.toString('base64');
    const githubPath = `armazenamento/${usuarioFormatado}.ndj`;

    // 4. Verifica SHA do arquivo para atualização
    let sha = undefined;
    const arquivoExistente = await buscarEBaixarArquivoNdj(githubPath);
    if (arquivoExistente) sha = arquivoExistente.sha;

    // 5. Salva em armazenamento/<usuario>.ndj
    const urlGithub = `https://api.github.com/repos/${GITHUB_REPO}/contents/${githubPath}`;
    const payload = {
      message: `feat: upload armazenamento extra para @${usuarioFormatado}`,
      content: base64Content,
      sha: sha
    };

    const ghRes = await fetch(urlGithub, {
      method: 'PUT',
      headers: {
        ...headersGitHub,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!ghRes.ok) {
      return res.status(500).json({ erro: "Falha ao gravar arquivo no GitHub." });
    }

    return res.status(200).json({
      mensagem: "Arquivo autenticado e salvo com sucesso!",
      usuario: usuarioFormatado,
      tamanhoOriginal: `${req.file.size} bytes`,
      tamanhoComprimido: `${finalBuffer.length} bytes`
    });

  } catch (err) {
    return res.status(500).json({ erro: "Erro interno no servidor de armazenamento.", detalhes: err.message });
  }
});

// ====================================================
// ROTA POST: /storage/get (Puxar/Descomprimir Conteúdo)
// ====================================================
app.post('/storage/get', async (req, res) => {
  try {
    const { usuario, senha } = req.body;

    if (!usuario || !senha) {
      return res.status(400).json({ erro: "Usuário e senha são obrigatórios." });
    }

    // 1. Validação de Credenciais com Bcrypt
    const credenciaisValidas = await autenticarUsuario(usuario, senha);
    if (!credenciaisValidas) {
      return res.status(401).json({ erro: "Credenciais inválidas." });
    }

    const usuarioFormatado = usuario.toLowerCase().trim();
    const githubPath = `armazenamento/${usuarioFormatado}.ndj`;

    // 2. Busca e descompacta o arquivo do repositório
    const arquivoArmazenado = await buscarEBaixarArquivoNdj(githubPath);

    if (!arquivoArmazenado) {
      return res.status(404).json({ erro: "Nenhum arquivo armazenado encontrado para este usuário." });
    }

    // 3. Devolve os dados originais descomprimidos
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${arquivoArmazenado.nomeOriginal}"`);
    return res.send(arquivoArmazenado.bufferOriginal);

  } catch (err) {
    return res.status(500).json({ erro: "Erro ao buscar conteúdo armazenado.", detalhes: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor de Armazenamento Extra rodando na porta ${PORT}`));
