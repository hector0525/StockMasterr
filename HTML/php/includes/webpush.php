<?php
/**
 * Web Push mínimo y sin dependencias (solo extensiones openssl y curl de PHP).
 *
 *  - Cifrado del mensaje: RFC 8291 (aes128gcm)
 *  - Identificación del servidor (VAPID): RFC 8292, JWT firmado con ES256
 *
 * Funciones de este archivo no tocan la base de datos; ver includes/push.php.
 */

function wp_b64u_encode(string $bin): string {
    return rtrim(strtr(base64_encode($bin), '+/', '-_'), '=');
}

function wp_b64u_decode(string $txt): string {
    $txt = strtr($txt, '-_', '+/');
    return base64_decode($txt . str_repeat('=', (4 - strlen($txt) % 4) % 4), true) ?: '';
}

/** Convierte un punto EC P-256 sin comprimir (65 bytes) en una clave pública PEM. */
function wp_pub_raw_a_pem(string $raw65) {
    $spki = hex2bin('3059301306072a8648ce3d020106082a8648ce3d030107034200') . $raw65;
    $pem = "-----BEGIN PUBLIC KEY-----\n" . chunk_split(base64_encode($spki), 64, "\n") . "-----END PUBLIC KEY-----\n";
    return openssl_pkey_get_public($pem);
}

/** Construye una clave privada OpenSSL a partir de d (32 bytes) y la pública (65 bytes). */
function wp_priv_raw_a_pem(string $d32, string $pub65) {
    $der = hex2bin('30770201010420') . $d32 . hex2bin('a00a06082a8648ce3d030107a144034200') . $pub65;
    $pem = "-----BEGIN EC PRIVATE KEY-----\n" . chunk_split(base64_encode($der), 64, "\n") . "-----END EC PRIVATE KEY-----\n";
    return openssl_pkey_get_private($pem);
}

/** Genera un par de claves EC P-256 y devuelve sus partes crudas. */
function wp_generar_par_ec(): array {
    $k = openssl_pkey_new(['curve_name' => 'prime256v1', 'private_key_type' => OPENSSL_KEYTYPE_EC]);
    if (!$k) throw new RuntimeException('No se pudo generar la clave EC (openssl).');
    $d = openssl_pkey_get_details($k)['ec'];
    return [
        'resource' => $k,
        'private'  => str_pad($d['d'], 32, "\0", STR_PAD_LEFT),
        'public'   => "\x04" . str_pad($d['x'], 32, "\0", STR_PAD_LEFT) . str_pad($d['y'], 32, "\0", STR_PAD_LEFT),
    ];
}

/** Genera claves VAPID en el formato que usan los navegadores (base64url). */
function wp_generar_vapid(): array {
    $p = wp_generar_par_ec();
    return ['public' => wp_b64u_encode($p['public']), 'private' => wp_b64u_encode($p['private'])];
}

/** Convierte una firma DER (ECDSA) en la forma cruda R||S de 64 bytes que exige JWT ES256. */
function wp_der_a_raw(string $der): string {
    $o = 3; // 30 len 02
    if (ord($der[1]) & 0x80) $o++;
    $lr = ord($der[$o]); $r = substr($der, $o + 1, $lr);
    $o += 1 + $lr + 1;
    $ls = ord($der[$o]); $s = substr($der, $o + 1, $ls);
    $r = str_pad(ltrim($r, "\0"), 32, "\0", STR_PAD_LEFT);
    $s = str_pad(ltrim($s, "\0"), 32, "\0", STR_PAD_LEFT);
    return $r . $s;
}

function wp_jwt_vapid(string $audience, string $subject, string $pubB64, string $privB64): string {
    $h = wp_b64u_encode(json_encode(['typ' => 'JWT', 'alg' => 'ES256']));
    $c = wp_b64u_encode(json_encode(['aud' => $audience, 'exp' => time() + 12 * 3600, 'sub' => $subject]));
    $key = wp_priv_raw_a_pem(wp_b64u_decode($privB64), wp_b64u_decode($pubB64));
    if (!$key) throw new RuntimeException('Clave privada VAPID inválida.');
    openssl_sign("$h.$c", $der, $key, OPENSSL_ALGO_SHA256);
    return "$h.$c." . wp_b64u_encode(wp_der_a_raw($der));
}

/** Cifra el mensaje para la suscripción (RFC 8291, aes128gcm). Devuelve el cuerpo binario. */
function wp_cifrar(string $mensaje, string $uaPublic65, string $authSecret16, ?array $efimero = null, ?string $salt = null): string {
    // $efimero y $salt solo se inyectan en pruebas (vector del RFC 8291); en producción son aleatorios.
    $as   = $efimero ?? wp_generar_par_ec();
    $uaPk = wp_pub_raw_a_pem($uaPublic65);
    if (!$uaPk) throw new RuntimeException('Clave p256dh de la suscripción inválida.');
    $ecdh = openssl_pkey_derive($uaPk, $as['resource'], 32);
    if ($ecdh === false) throw new RuntimeException('Fallo ECDH.');
    $ecdh = str_pad($ecdh, 32, "\0", STR_PAD_LEFT);

    $ikm   = hash_hkdf('sha256', $ecdh, 32, "WebPush: info\0" . $uaPublic65 . $as['public'], $authSecret16);
    $salt  = $salt ?? random_bytes(16);
    $cek   = hash_hkdf('sha256', $ikm, 16, "Content-Encoding: aes128gcm\0", $salt);
    $nonce = hash_hkdf('sha256', $ikm, 12, "Content-Encoding: nonce\0", $salt);

    $registro = $mensaje . "\x02";   // delimitador del último (y único) registro
    $cifrado  = openssl_encrypt($registro, 'aes-128-gcm', $cek, OPENSSL_RAW_DATA, $nonce, $tag, '', 16);
    if ($cifrado === false) throw new RuntimeException('Fallo AES-GCM.');

    return $salt . pack('N', 4096) . chr(65) . $as['public'] . $cifrado . $tag;
}

/** ¿El endpoint pertenece a un servicio push conocido? Evita que se use el servidor para llamar a hosts arbitrarios (SSRF). */
function wp_endpoint_permitido(string $endpoint): bool {
    $p = parse_url($endpoint);
    if (!$p || ($p['scheme'] ?? '') !== 'https' || empty($p['host'])) return false;
    $host = strtolower($p['host']);
    $permitidos = ['.googleapis.com', '.push.services.mozilla.com', '.push.apple.com', '.notify.windows.com'];
    $extra = getenv('PUSH_ALLOWED_HOSTS'); // dominios adicionales separados por coma (opcional)
    if ($extra) foreach (explode(',', $extra) as $e) { $e = trim(strtolower($e)); if ($e !== '') $permitidos[] = '.' . ltrim($e, '.'); }
    foreach ($permitidos as $suf) {
        if ($host === ltrim($suf, '.') || substr($host, -strlen($suf)) === $suf) return true;
    }
    return false;
}

/**
 * Envía un mensaje push.
 * @param array $sub     ['endpoint'=>, 'p256dh'=>, 'auth'=>] (base64url)
 * @param array $payload se envía como JSON
 * @param array $vapid   ['public'=>, 'private'=>, 'subject'=>]
 * @param array $op      ttl, urgency, timeout, saltar_verificacion (solo pruebas)
 * @return array ['ok'=>bool, 'status'=>int, 'expirada'=>bool, 'error'=>string]
 */
function wp_enviar(array $sub, array $payload, array $vapid, array $op = []): array {
    $r = ['ok' => false, 'status' => 0, 'expirada' => false, 'error' => ''];
    try {
        if (empty($op['saltar_verificacion']) && !wp_endpoint_permitido($sub['endpoint'])) {
            throw new RuntimeException('Endpoint no permitido.');
        }
        $cuerpo = wp_cifrar(json_encode($payload, JSON_UNESCAPED_UNICODE),
                            wp_b64u_decode($sub['p256dh']), wp_b64u_decode($sub['auth']));
        $u   = parse_url($sub['endpoint']);
        $aud = $u['scheme'] . '://' . $u['host'] . (isset($u['port']) ? ':' . $u['port'] : '');
        $jwt = wp_jwt_vapid($aud, $vapid['subject'], $vapid['public'], $vapid['private']);

        $ch = curl_init($sub['endpoint']);
        curl_setopt_array($ch, [
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => $cuerpo,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => $op['timeout'] ?? 6,
            CURLOPT_CONNECTTIMEOUT => 4,
            CURLOPT_HTTPHEADER     => [
                'Authorization: vapid t=' . $jwt . ', k=' . $vapid['public'],
                'Content-Encoding: aes128gcm',
                'Content-Type: application/octet-stream',
                'Content-Length: ' . strlen($cuerpo),
                'TTL: ' . ($op['ttl'] ?? 86400),
                'Urgency: ' . ($op['urgency'] ?? 'normal'),
            ],
        ]);
        curl_exec($ch);
        $r['status'] = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        if (curl_errno($ch)) $r['error'] = curl_error($ch);
        curl_close($ch);

        $r['ok']       = $r['status'] >= 200 && $r['status'] < 300;
        $r['expirada'] = in_array($r['status'], [404, 410], true);
        if (!$r['ok'] && !$r['error']) $r['error'] = 'HTTP ' . $r['status'];
    } catch (Throwable $e) {
        $r['error'] = $e->getMessage();
    }
    return $r;
}
