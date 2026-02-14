struct ShadowUniforms {
  lightViewProjection: mat4x4<f32>,
  shadowSoftness: f32,
  particleShadowRadius: f32,
  pad0: f32,
  pad1: f32,
};

// Beginner note: this shared struct is included by multiple shaders so the
// shadow map uniforms stay consistent across passes.
